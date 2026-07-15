import prisma from '@/lib/prisma';
import { publicAuthorSelect } from '@/lib/server/content';
import {
  ApiError,
  assertSameOrigin,
  enforceRateLimit,
  isUniqueConstraintError,
  json,
  jsonError,
  readJson,
} from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';
import { publishRealtimeEvent } from '@/lib/server/realtime';
import { anonymousNickname, getPlatformMode, maskPublicIdentities } from '@/lib/server/platform-mode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const rooms = await prisma.chatRoom.findMany({
      where: { members: { some: { userId: session.user.id, leftAt: null } } },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      include: {
        members: {
          where: { leftAt: null },
          select: {
            userId: true,
            role: true,
            joinedAt: true,
            lastReadMessage: { select: { createdAt: true } },
            user: { select: publicAuthorSelect },
          },
        },
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            content: true,
            createdAt: true,
            sender: { select: { id: true, nickname: true, realName: true } },
          },
        },
      },
    });
    const roomsWithUnread = await Promise.all(rooms.map(async (room) => {
      const membership = room.members.find((member) => member.userId === session.user.id);
      const unreadCount = membership
        ? await prisma.message.count({
            where: {
              roomId: room.id,
              deletedAt: null,
              senderId: { not: session.user.id },
              createdAt: { gt: membership.lastReadMessage?.createdAt ?? membership.joinedAt },
            },
          })
        : 0;
      return { ...room, unreadCount };
    }));
    return json({ rooms: await maskPublicIdentities(roomsWithUnread, session.user.id) }, 200, {
      'Cache-Control': 'private, no-cache',
      Vary: 'Cookie',
    });
  } catch (error) {
    return jsonError(error);
  }
}

interface CreateRoomBody {
  title?: unknown;
  memberIds?: unknown;
  recipientId?: unknown;
  authorNickname?: unknown;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    enforceRateLimit(`chat-room-create:${session.user.id}`, {
      limit: 20,
      windowMs: 24 * 60 * 60 * 1_000,
    });
    const body = await readJson<CreateRoomBody>(request, 16_384);
    let memberIds = Array.isArray(body.memberIds)
      ? body.memberIds.filter((id): id is string => typeof id === 'string')
      : typeof body.recipientId === 'string'
        ? [body.recipientId]
        : [];

    // Legacy clients used a nickname; resolve it without exposing any private data.
    if (memberIds.length === 0 && typeof body.authorNickname === 'string') {
      const legacyMember = await prisma.user.findUnique({
        where: { nickname: body.authorNickname.trim() },
        select: { id: true },
      });
      if (legacyMember && legacyMember.id !== session.user.id) memberIds = [legacyMember.id];
    }
    memberIds = Array.from(new Set(memberIds.map((id) => id.trim()).filter(Boolean)));
    if (memberIds.length > 9) {
      throw new ApiError(400, 'TOO_MANY_MEMBERS', '한 대화방에는 최대 9명까지 초대할 수 있습니다.');
    }
    if (memberIds.length < 1) {
      throw new ApiError(400, 'MEMBER_REQUIRED', '대화 상대를 한 명 이상 선택해 주세요.');
    }
    const platformMode = await getPlatformMode();
    const anonymousIdentifiers = platformMode.bSideEnabled
      ? memberIds.filter((value) => /^#[A-F0-9]{8}$/i.test(value))
      : [];
    const anonymousCandidates = anonymousIdentifiers.length
      ? await prisma.user.findMany({
          where: { status: 'ACTIVE' },
          select: { id: true },
          take: 1_000,
        })
      : [];
    const uuidIdentifiers = memberIds.filter((value) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
    );
    const members = await prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { loginId: { in: memberIds } },
          { studentIdentity: { studentCode: { in: memberIds } } },
          ...(uuidIdentifiers.length ? [{ id: { in: uuidIdentifiers } }] : []),
        ],
      },
      select: {
        id: true,
        loginId: true,
        studentIdentity: { select: { studentCode: true } },
      },
    });
    const resolvedMemberIds = memberIds.map((identifier) => {
      if (platformMode.bSideEnabled && /^#[A-F0-9]{8}$/i.test(identifier)) {
        return anonymousCandidates.find(
          (candidate) =>
            anonymousNickname(candidate.id, platformMode.bSideEpoch).toLowerCase() ===
            identifier.toLowerCase(),
        )?.id ?? null;
      }
      return members.find((member) =>
        member.id === identifier ||
        member.loginId === identifier ||
        member.studentIdentity?.studentCode === identifier,
      )?.id ?? null;
    });
    if (resolvedMemberIds.some((id) => !id)) {
      throw new ApiError(400, 'INVALID_MEMBER', '대화할 수 없는 사용자가 포함되어 있습니다.');
    }
    memberIds = resolvedMemberIds as string[];
    if (memberIds.includes(session.user.id)) {
      throw new ApiError(400, 'SELF_MEMBER', '본인은 대화 상대 목록에 넣지 않아도 됩니다.');
    }
    if (new Set(memberIds).size !== memberIds.length) {
      throw new ApiError(400, 'DUPLICATE_MEMBER', '같은 대화 상대가 중복으로 입력되었습니다.');
    }

    const allMemberIds = [session.user.id, ...memberIds].sort();
    const direct = allMemberIds.length === 2;
    const directKey = direct ? allMemberIds.join(':') : null;
    if (directKey) {
      const existing = await prisma.chatRoom.findUnique({
        where: { directKey },
        include: { members: { include: { user: { select: publicAuthorSelect } } } },
      });
      if (existing) {
        await prisma.chatMember.updateMany({
          where: { roomId: existing.id, userId: { in: allMemberIds } },
          data: { leftAt: null },
        });
        const reactivated = await prisma.chatRoom.findUniqueOrThrow({
          where: { id: existing.id },
          include: {
            members: {
              where: { leftAt: null },
              include: { user: { select: publicAuthorSelect } },
            },
          },
        });
        await publishRealtimeEvent('room-created', { roomId: reactivated.id, memberIds: allMemberIds });
        return json({
          room: await maskPublicIdentities(reactivated, session.user.id),
          existing: true,
        });
      }
    }
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 120) || null : null;
    if (!direct && !title) {
      throw new ApiError(400, 'TITLE_REQUIRED', '그룹 대화방 이름을 입력해 주세요.');
    }

    let room;
    try {
      room = await prisma.chatRoom.create({
        data: {
          type: direct ? 'DIRECT' : 'GROUP',
          title: direct ? null : title,
          createdById: session.user.id,
          directKey,
          members: {
            create: allMemberIds.map((userId) => ({
              userId,
              role: userId === session.user.id ? 'OWNER' : 'MEMBER',
            })),
          },
        },
        include: { members: { include: { user: { select: publicAuthorSelect } } } },
      });
    } catch (error) {
      if (!directKey || !isUniqueConstraintError(error)) throw error;
      room = await prisma.chatRoom.findUniqueOrThrow({
        where: { directKey },
        include: { members: { include: { user: { select: publicAuthorSelect } } } },
      });
      await prisma.chatMember.updateMany({
        where: { roomId: room.id, userId: { in: allMemberIds } },
        data: { leftAt: null },
      });
      const reactivated = await prisma.chatRoom.findUniqueOrThrow({
        where: { id: room.id },
        include: {
          members: {
            where: { leftAt: null },
            include: { user: { select: publicAuthorSelect } },
          },
        },
      });
      await publishRealtimeEvent('room-created', { roomId: reactivated.id, memberIds: allMemberIds });
      return json({
        room: await maskPublicIdentities(reactivated, session.user.id),
        existing: true,
      });
    }
    await publishRealtimeEvent('room-created', { roomId: room.id, memberIds: allMemberIds });
    return json({
      room: await maskPublicIdentities(room, session.user.id),
      existing: false,
    }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
