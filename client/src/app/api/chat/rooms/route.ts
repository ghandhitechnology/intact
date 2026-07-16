import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { publicAuthorSelect } from '@/lib/server/content';
import {
  ApiError,
  assertSameOrigin,
  enforceDistributedRateLimit,
  enforceRateLimit,
  isUniqueConstraintError,
  json,
  jsonError,
  readJson,
} from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';
import {
  outboxPublicationEnabled,
  publishRealtimeEvent,
  queueRealtimeEvent,
} from '@/lib/server/realtime';
import { getPlatformMode, maskPublicIdentities } from '@/lib/server/platform-mode';

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
            lastReadSequence: true,
            lastReadMessage: { select: { createdAt: true, sequence: true } },
            user: { select: publicAuthorSelect },
          },
        },
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            sequence: true,
            content: true,
            createdAt: true,
            sender: { select: { id: true, nickname: true, realName: true } },
          },
        },
      },
    });
    const unreadRows = rooms.length
      ? await prisma.$queryRaw<Array<{ roomId: string; unreadCount: bigint }>>(Prisma.sql`
          SELECT message."roomId", COUNT(*)::bigint AS "unreadCount"
          FROM "Message" AS message
          INNER JOIN "ChatMember" AS membership
            ON membership."roomId" = message."roomId"
          WHERE membership."userId" = ${session.user.id}
            AND membership."leftAt" IS NULL
            AND message."deletedAt" IS NULL
            AND message."senderId" <> ${session.user.id}
            AND message."createdAt" >= membership."joinedAt"
            AND message."sequence" > membership."lastReadSequence"
          GROUP BY message."roomId"
        `)
      : [];
    const unreadByRoom = new Map(
      unreadRows.map((row) => [row.roomId, Number(row.unreadCount)]),
    );
    const roomsWithUnread = rooms.map((room) => ({
      ...room,
      unreadCount: unreadByRoom.get(room.id) ?? 0,
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

type CreatedRoom = Prisma.ChatRoomGetPayload<{
  include: {
    members: {
      include: {
        user: { select: typeof publicAuthorSelect };
      };
    };
  };
}>;

function queueRoomCreated(
  tx: Prisma.TransactionClient,
  roomId: string,
  memberIds: string[],
  eventKey: string,
) {
  if (!outboxPublicationEnabled()) return Promise.resolve({ inserted: false });
  return queueRealtimeEvent(
    tx,
    'room-created',
    { roomId, memberIds },
    `realtime:room-created:${roomId}:${eventKey}`,
  );
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    const roomEventKey = crypto.randomUUID();
    enforceRateLimit(`chat-room-create:${session.user.id}`, {
      limit: 20,
      windowMs: 24 * 60 * 60 * 1_000,
    });
    await enforceDistributedRateLimit(`chat-room-create:${session.user.id}`, {
      limit: 20,
      windowMs: 24 * 60 * 60 * 1_000,
      failPolicy: 'open',
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
    const anonymousAliases = anonymousIdentifiers.length
      ? await prisma.platformAlias.findMany({
          where: {
            epoch: platformMode.bSideEpoch,
            alias: { in: anonymousIdentifiers.map((value) => value.toUpperCase()) },
          },
          select: { alias: true, userId: true },
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
        return anonymousAliases.find(
          (candidate) => candidate.alias.toLowerCase() === identifier.toLowerCase(),
        )?.userId ?? null;
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
        const reactivated = await prisma.$transaction(async (tx) => {
          await tx.chatMember.updateMany({
            where: { roomId: existing.id, userId: { in: allMemberIds } },
            data: { leftAt: null },
          });
          const value = await tx.chatRoom.findUniqueOrThrow({
            where: { id: existing.id },
            include: {
              members: {
                where: { leftAt: null },
                include: { user: { select: publicAuthorSelect } },
              },
            },
          });
          await queueRoomCreated(tx, value.id, allMemberIds, roomEventKey);
          return value;
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

    let room: CreatedRoom;
    try {
      room = await prisma.$transaction(async (tx) => {
        const created = await tx.chatRoom.create({
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
        await queueRoomCreated(tx, created.id, allMemberIds, roomEventKey);
        return created;
      });
    } catch (error) {
      if (!directKey || !isUniqueConstraintError(error)) throw error;
      room = await prisma.chatRoom.findUniqueOrThrow({
        where: { directKey },
        include: { members: { include: { user: { select: publicAuthorSelect } } } },
      });
      const reactivated = await prisma.$transaction(async (tx) => {
        await tx.chatMember.updateMany({
          where: { roomId: room.id, userId: { in: allMemberIds } },
          data: { leftAt: null },
        });
        const value = await tx.chatRoom.findUniqueOrThrow({
          where: { id: room.id },
          include: {
            members: {
              where: { leftAt: null },
              include: { user: { select: publicAuthorSelect } },
            },
          },
        });
        await queueRoomCreated(tx, value.id, allMemberIds, roomEventKey);
        return value;
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
