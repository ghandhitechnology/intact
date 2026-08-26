import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { createNotificationsWithDelivery } from '@/lib/server/notifications';
import {
  assertRoomCapacity,
  collectMemberIdentifiers,
  loadRoomWithMembers,
  requireActiveMembership,
  resolveChatMemberIds,
} from '@/lib/server/chat-members';
import {
  ApiError,
  assertSameOrigin,
  enforceDistributedRateLimit,
  enforceRateLimit,
  json,
  jsonError,
  readJson,
} from '@/lib/server/http';
import {
  outboxPublicationEnabled,
  publishRealtimeEvent,
  queueRealtimeEvent,
} from '@/lib/server/realtime';
import { maskPublicIdentities } from '@/lib/server/platform-mode';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function queueMembershipChange(
  tx: Prisma.TransactionClient,
  roomId: string,
  memberIds: string[],
) {
  if (!outboxPublicationEnabled()) return;
  await queueRealtimeEvent(
    tx,
    'room-created',
    { roomId, memberIds },
    `realtime:room-created:${roomId}:${crypto.randomUUID()}`,
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: roomId } = await context.params;
    assertSameOrigin(request);
    const session = await requireUser(request);
    enforceRateLimit(`chat-member-add:${session.user.id}`, {
      limit: 40,
      windowMs: 60 * 60 * 1_000,
    });
    await enforceDistributedRateLimit(`chat-member-add:${session.user.id}`, {
      limit: 40,
      windowMs: 60 * 60 * 1_000,
      failPolicy: 'open',
    });
    await requireActiveMembership(roomId, session.user.id);
    const body = await readJson<{ memberIds?: unknown; recipientId?: unknown }>(request, 16_384);
    const memberIds = await resolveChatMemberIds({
      identifiers: collectMemberIdentifiers(body),
      actorId: session.user.id,
    });

    const room = await prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: {
        id: true,
        type: true,
        title: true,
        members: {
          select: { userId: true, leftAt: true },
        },
      },
    });
    if (!room) {
      throw new ApiError(404, 'ROOM_NOT_FOUND', '대화방을 찾을 수 없습니다.');
    }

    const activeIds = new Set(
      room.members.filter((member) => !member.leftAt).map((member) => member.userId),
    );
    const alreadyActive = memberIds.filter((id) => activeIds.has(id));
    if (alreadyActive.length) {
      throw new ApiError(409, 'ALREADY_MEMBER', '이미 참여 중인 사용자가 포함되어 있습니다.');
    }
    const addingIds = memberIds.filter((id) => !activeIds.has(id));
    assertRoomCapacity(activeIds.size, addingIds.length);

    const existingIds = new Set(room.members.map((member) => member.userId));
    const updated = await prisma.$transaction(async (tx) => {
      if (room.type === 'DIRECT') {
        await tx.chatRoom.update({
          where: { id: roomId },
          data: { type: 'GROUP', directKey: null },
        });
      }
      for (const userId of addingIds) {
        if (existingIds.has(userId)) {
          await tx.chatMember.update({
            where: { roomId_userId: { roomId, userId } },
            data: { leftAt: null, role: 'MEMBER', joinedAt: new Date() },
          });
        } else {
          await tx.chatMember.create({
            data: { roomId, userId, role: 'MEMBER' },
          });
        }
      }
      const allMemberIds = [...activeIds, ...addingIds];
      if (addingIds.length) {
        await createNotificationsWithDelivery(
          tx,
          addingIds.map((userId) => ({
            userId,
            actorId: session.user.id,
            type: 'MESSAGE' as const,
            title: '대화방에 초대되었습니다.',
            body: room.title?.trim() || '그룹 대화',
            href: `/messages?roomId=${encodeURIComponent(roomId)}`,
            metadata: { roomId },
          })),
        );
      }
      await queueMembershipChange(tx, roomId, allMemberIds);
    });

    await publishRealtimeEvent('room-created', {
      roomId,
      memberIds: [...activeIds, ...addingIds],
    });
    const roomWithMembers = await loadRoomWithMembers(roomId);
    return json({ room: await maskPublicIdentities(roomWithMembers, session.user.id) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: roomId } = await context.params;
    assertSameOrigin(request);
    const session = await requireUser(request);
    const membership = await requireActiveMembership(roomId, session.user.id);
    const body = await readJson<{ userId?: unknown }>(request, 4_096);
    const targetId =
      typeof body.userId === 'string' && body.userId.trim()
        ? body.userId.trim()
        : session.user.id;
    const kicking = targetId !== session.user.id;
    if (kicking && membership.role !== 'OWNER') {
      throw new ApiError(403, 'NOT_ROOM_OWNER', '방장만 다른 참여자를 내보낼 수 있습니다.');
    }

    const target = await prisma.chatMember.findUnique({
      where: { roomId_userId: { roomId, userId: targetId } },
      select: { role: true, leftAt: true },
    });
    if (!target || target.leftAt) {
      throw new ApiError(404, 'MEMBER_NOT_FOUND', '해당 참여자를 찾을 수 없습니다.');
    }

    const remaining = await prisma.$transaction(async (tx) => {
      await tx.chatMember.update({
        where: { roomId_userId: { roomId, userId: targetId } },
        data: { leftAt: new Date() },
      });
      const others = await tx.chatMember.findMany({
        where: { roomId, leftAt: null },
        orderBy: { joinedAt: 'asc' },
        select: { userId: true, role: true },
      });
      if (
        target.role === 'OWNER' &&
        others.length > 0 &&
        !others.some((member) => member.role === 'OWNER')
      ) {
        await tx.chatMember.update({
          where: { roomId_userId: { roomId, userId: others[0].userId } },
          data: { role: 'OWNER' },
        });
      }
      await queueMembershipChange(
        tx,
        roomId,
        [...others.map((member) => member.userId), targetId],
      );
      return others;
    });

    await publishRealtimeEvent('room-created', {
      roomId,
      memberIds: [...remaining.map((member) => member.userId), targetId],
    });

    if (targetId === session.user.id) {
      return json({ left: true, roomId });
    }
    const room = await loadRoomWithMembers(roomId);
    return json({ room: await maskPublicIdentities(room, session.user.id) });
  } catch (error) {
    return jsonError(error);
  }
}
