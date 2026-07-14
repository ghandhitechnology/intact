import prisma from '@/lib/prisma';
import { parseAttachmentIds, publicAuthorSelect } from '@/lib/server/content';
import {
  ApiError,
  assertSameOrigin,
  enforceRateLimit,
  isUniqueConstraintError,
  json,
  jsonError,
  readJson,
  requiredString,
} from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';
import { isRealtimeGatewayRequest, publishRealtimeEvent } from '@/lib/server/realtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireMembership(roomId: string, userId: string) {
  const membership = await prisma.chatMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
  });
  if (!membership || membership.leftAt) {
    throw new ApiError(403, 'NOT_A_ROOM_MEMBER', '이 대화방에 참여하고 있지 않습니다.');
  }
  return membership;
}

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const url = new URL(request.url);
    const roomId = requiredString(url.searchParams.get('roomId'), 'roomId', { max: 64 });
    await requireMembership(roomId, session.user.id);
    const before = url.searchParams.get('before');
    const beforeDate = before ? new Date(before) : null;
    if (beforeDate && Number.isNaN(beforeDate.getTime())) {
      throw new ApiError(400, 'INVALID_CURSOR', '메시지 페이지 기준 시간이 올바르지 않습니다.');
    }
    const [messages, otherMemberships] = await prisma.$transaction([
      prisma.message.findMany({
      where: {
        roomId,
        ...(beforeDate ? { createdAt: { lt: beforeDate } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 101,
      select: {
        id: true,
        createdAt: true,
        editedAt: true,
        deletedAt: true,
        replyToId: true,
        content: true,
        sender: { select: publicAuthorSelect },
        attachments: {
          where: { scanStatus: 'CLEAN' },
          select: { id: true, originalName: true, mimeType: true, sizeBytes: true },
        },
      },
      }),
      prisma.chatMember.findMany({
        where: { roomId, userId: { not: session.user.id }, leftAt: null },
        select: { lastReadMessage: { select: { createdAt: true } } },
      }),
    ]);
    const hasMore = messages.length > 100;
    const page = messages.slice(0, 100);
    const chronological = page.reverse().map((message) => ({
      ...(message.deletedAt ? { ...message, content: '삭제된 메시지입니다.', attachments: [] } : message),
      readByAll:
        message.sender.id === session.user.id &&
        otherMemberships.length > 0 &&
        otherMemberships.every((member) =>
          Boolean(member.lastReadMessage && member.lastReadMessage.createdAt >= message.createdAt),
        ),
    }));
    return json({
      messages: chronological,
      hasMore,
      nextCursor: hasMore ? chronological[0]?.createdAt.toISOString() ?? null : null,
    });
  } catch (error) {
    return jsonError(error);
  }
}

interface MessageBody {
  roomId?: unknown;
  content?: unknown;
  replyToId?: unknown;
  attachmentIds?: unknown;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    enforceRateLimit(`message-create:${session.user.id}`, {
      limit: 90,
      windowMs: 60 * 1_000,
    });
    const body = await readJson<MessageBody>(request, 16_384);
    const roomId = requiredString(body.roomId, 'roomId', { max: 64 });
    const content = requiredString(body.content, '메시지', { min: 1, max: 5_000 });
    const attachmentIds = parseAttachmentIds(body.attachmentIds);
    if (!attachmentIds || attachmentIds.length > 1) {
      throw new ApiError(400, 'INVALID_ATTACHMENTS', '메시지에는 파일을 하나만 첨부할 수 있습니다.');
    }
    const membership = await requireMembership(roomId, session.user.id);
    if (membership.mutedUntil && membership.mutedUntil > new Date()) {
      throw new ApiError(403, 'ROOM_MUTED', '이 대화방에서 메시지 작성이 일시 제한되었습니다.');
    }
    const replyToId = typeof body.replyToId === 'string' && body.replyToId ? body.replyToId : null;
    const clientKey = request.headers.get('idempotency-key')?.trim().slice(0, 100) || null;
    const clientId = clientKey ? `message:${session.user.id}:${clientKey}` : null;
    if (replyToId) {
      const reply = await prisma.message.findUnique({ where: { id: replyToId }, select: { roomId: true } });
      if (!reply || reply.roomId !== roomId) {
        throw new ApiError(400, 'INVALID_REPLY', '답장할 메시지를 찾을 수 없습니다.');
      }
    }

    const messageSelect = {
      id: true,
      roomId: true,
      createdAt: true,
      replyToId: true,
      content: true,
      sender: { select: publicAuthorSelect },
      attachments: { select: { originalName: true } },
    } as const;
    let message;
    try {
      message = await prisma.$transaction(async (tx) => {
        if (clientId) {
          const existing = await tx.message.findUnique({
            where: { clientId },
            select: messageSelect,
          });
          if (existing) return existing;
        }
        const created = await tx.message.create({
          data: { roomId, senderId: session.user.id, content, replyToId, clientId },
          select: messageSelect,
        });
        if (attachmentIds.length) {
          const attached = await tx.attachment.updateMany({
            where: {
              id: { in: attachmentIds },
              uploaderId: session.user.id,
              postId: null,
              messageId: null,
            },
            data: { messageId: created.id },
          });
          if (attached.count !== attachmentIds.length) {
            throw new ApiError(400, 'INVALID_ATTACHMENTS', '첨부 파일 정보가 올바르지 않습니다. 파일을 다시 선택해 주세요.');
          }
        }
        await tx.chatRoom.update({
          where: { id: roomId },
          data: { lastMessageAt: created.createdAt },
        });
        const recipients = await tx.chatMember.findMany({
          where: {
            roomId,
            leftAt: null,
            userId: { not: session.user.id },
            OR: [{ mutedUntil: null }, { mutedUntil: { lte: new Date() } }],
          },
          select: { userId: true },
        });
        if (recipients.length) {
          await tx.notification.createMany({
            data: recipients.map(({ userId }) => ({
              userId,
              actorId: session.user.id,
              type: 'MESSAGE',
              title: `${session.user.nickname}님의 새 메시지`,
              body: content.slice(0, 120),
              href: `/messages?roomId=${encodeURIComponent(roomId)}`,
              metadata: { roomId, messageId: created.id },
            })),
          });
        }
        return attachmentIds.length
          ? tx.message.findUniqueOrThrow({ where: { id: created.id }, select: messageSelect })
          : created;
      });
    } catch (error) {
      if (!clientId || !isUniqueConstraintError(error)) throw error;
      message = await prisma.message.findUniqueOrThrow({
        where: { clientId },
        select: messageSelect,
      });
    }
    if (!isRealtimeGatewayRequest(request)) {
      await publishRealtimeEvent('message', { roomId, message });
    }
    if (clientId) {
      return Response.json(message, {
        status: 201,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    return json({ message }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    const body = await readJson<{ roomId?: unknown; messageId?: unknown }>(request, 8_192);
    const roomId = requiredString(body.roomId, 'roomId', { max: 64 });
    const messageId = requiredString(body.messageId, 'messageId', { max: 64 });
    await requireMembership(roomId, session.user.id);
    const message = await prisma.message.findFirst({
      where: { id: messageId, roomId },
      select: { id: true },
    });
    if (!message) throw new ApiError(404, 'MESSAGE_NOT_FOUND', '메시지를 찾을 수 없습니다.');
    await prisma.chatMember.update({
      where: { roomId_userId: { roomId, userId: session.user.id } },
      data: { lastReadMessageId: message.id },
    });
    return json({ read: true, roomId, messageId });
  } catch (error) {
    return jsonError(error);
  }
}
