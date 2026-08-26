import prisma from '@/lib/prisma';
import { bindEligibleAttachments } from '@/lib/server/attachment-state';
import { attachmentSelect, parseAttachmentIds, publicAuthorSelect } from '@/lib/server/content';
import {
  chatMessageEnvelope,
  compoundTimeCursor,
  messageRequestHash,
  parseChatCursor,
  sequenceCursor,
  serializeChatMessage,
} from '@/lib/server/chat';
import {
  ApiError,
  assertSameOrigin,
  enforceDistributedRateLimit,
  enforceRateLimit,
  isUniqueConstraintError,
  json,
  jsonError,
  readJson,
  requiredString,
} from '@/lib/server/http';
import { toOutboxJson } from '@/lib/server/outbox';
import { createNotificationsWithDelivery } from '@/lib/server/notifications';
import { requireUser } from '@/lib/server/session';
import { assertAttachmentAllowedOnBoard } from '@/lib/server/multipart-upload';
import {
  isRealtimeGatewayRequest,
  outboxPublicationEnabled,
  publishRealtimeEvent,
  queueRealtimeEvent,
} from '@/lib/server/realtime';
import {
  anonymousNickname,
  getPlatformMode,
  maskPublicIdentitiesWithMode,
} from '@/lib/server/platform-mode';

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

    const beforeSequence = url.searchParams.get('beforeSequence');
    const before = url.searchParams.get('before');
    const cursor = parseChatCursor(beforeSequence ?? before);
    if ((beforeSequence ?? before) && !cursor) {
      throw new ApiError(400, 'INVALID_CURSOR', '메시지 페이지 기준이 올바르지 않습니다.');
    }
    if (beforeSequence && cursor?.kind !== 'sequence') {
      throw new ApiError(400, 'INVALID_CURSOR', '메시지 순서 기준이 올바르지 않습니다.');
    }

    const cursorWhere =
      cursor?.kind === 'sequence'
        ? { sequence: { lt: cursor.sequence } }
        : cursor?.kind === 'compound'
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : cursor?.kind === 'legacy-time'
            ? { createdAt: { lt: cursor.createdAt } }
            : {};
    const legacyTimestampOrder =
      cursor?.kind === 'compound' || cursor?.kind === 'legacy-time';

    const [messages, otherMemberships] = await prisma.$transaction([
      prisma.message.findMany({
        where: { roomId, ...cursorWhere },
        orderBy: legacyTimestampOrder
          ? [{ createdAt: 'desc' }, { id: 'desc' }]
          : [{ sequence: 'desc' }],
        take: 101,
        select: {
          id: true,
          roomId: true,
          sequence: true,
          createdAt: true,
          editedAt: true,
          deletedAt: true,
          replyToId: true,
          content: true,
          sender: { select: publicAuthorSelect },
          attachments: {
            where: { scanStatus: 'CLEAN' },
            orderBy: { createdAt: 'asc' },
            select: attachmentSelect,
          },
        },
      }),
      prisma.chatMember.findMany({
        where: { roomId, userId: { not: session.user.id }, leftAt: null },
        select: { lastReadSequence: true },
      }),
    ]);
    const hasMore = messages.length > 100;
    const page = messages.slice(0, 100);
    const oldest = page[page.length - 1];
    const chronological = page.reverse().map((message) =>
      serializeChatMessage({
        ...(message.deletedAt
          ? { ...message, content: '삭제된 메시지입니다.', attachments: [] }
          : message),
        readByAll:
          message.sender.id === session.user.id &&
          otherMemberships.length > 0 &&
          otherMemberships.every((member) => member.lastReadSequence >= message.sequence),
      }),
    );
    const platformMode = await getPlatformMode();
    return json({
      messages: await maskPublicIdentitiesWithMode(chronological, session.user.id, platformMode),
      hasMore,
      nextCursor: hasMore && oldest ? sequenceCursor(oldest.sequence) : null,
      legacyNextCursor:
        hasMore && oldest ? compoundTimeCursor(oldest.createdAt, oldest.id) : null,
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
    assertSameOrigin(request, { allowRealtimeGateway: true });
    const session = await requireUser(request);
    enforceRateLimit(`message-create:${session.user.id}`, {
      limit: 90,
      windowMs: 60 * 1_000,
    });
    await enforceDistributedRateLimit(`message-create:${session.user.id}`, {
      limit: 90,
      windowMs: 60 * 1_000,
      failPolicy: 'open',
    });
    const body = await readJson<MessageBody>(request, 16_384);
    const roomId = requiredString(body.roomId, 'roomId', { max: 64 });
    const content = requiredString(body.content, '메시지', { min: 1, max: 5_000 });
    const attachmentIds = parseAttachmentIds(body.attachmentIds);
    if (!attachmentIds || attachmentIds.length > 1) {
      throw new ApiError(400, 'INVALID_ATTACHMENTS', '메시지에는 파일을 하나만 첨부할 수 있습니다.');
    }
    const replyToId = typeof body.replyToId === 'string' && body.replyToId ? body.replyToId : null;
    const clientKey = request.headers.get('idempotency-key')?.trim().slice(0, 100) || null;
    const clientId = clientKey ? `message:${session.user.id}:${clientKey}` : null;
    const requestHash = messageRequestHash({
      roomId,
      senderId: session.user.id,
      content,
      replyToId,
      attachmentIds,
    });
    const platformMode = await getPlatformMode();
    const messageSelect = {
      id: true,
      roomId: true,
      sequence: true,
      requestHash: true,
      createdAt: true,
      editedAt: true,
      deletedAt: true,
      replyToId: true,
      content: true,
      sender: { select: publicAuthorSelect },
      attachments: {
        where: { scanStatus: 'CLEAN' },
        orderBy: { createdAt: 'asc' as const },
        select: attachmentSelect,
      },
    } as const;

    function assertMatchingReplay(existing: {
      roomId: string;
      requestHash: string | null;
      content: string;
      replyToId: string | null;
      sender: { id: string };
      attachments: Array<{ id: string }>;
    }) {
      const persistedHash =
        existing.requestHash ??
        messageRequestHash({
          roomId: existing.roomId,
          senderId: existing.sender.id,
          content: existing.content,
          replyToId: existing.replyToId,
          attachmentIds: existing.attachments.map((attachment) => attachment.id),
        });
      if (persistedHash !== requestHash) {
        throw new ApiError(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          '같은 요청 키를 다른 메시지에 다시 사용할 수 없습니다.',
        );
      }
    }

    const replayCandidate = clientId
      ? await prisma.message.findUnique({
          where: { clientId },
          select: messageSelect,
        })
      : null;
    if (replayCandidate) assertMatchingReplay(replayCandidate);

    let message;
    let replayed = false;
    if (replayCandidate) {
      message = replayCandidate;
      replayed = true;
    } else {
      const membership = await requireMembership(roomId, session.user.id);
      if (membership.mutedUntil && membership.mutedUntil > new Date()) {
        throw new ApiError(403, 'ROOM_MUTED', '이 대화방에서 메시지 작성이 일시 제한되었습니다.');
      }
      if (replyToId) {
        const reply = await prisma.message.findUnique({ where: { id: replyToId }, select: { roomId: true } });
        if (!reply || reply.roomId !== roomId) {
          throw new ApiError(400, 'INVALID_REPLY', '답장할 메시지를 찾을 수 없습니다.');
        }
      }

      try {
      const result = await prisma.$transaction(async (tx) => {
        if (clientId) {
          const existing = await tx.message.findUnique({
            where: { clientId },
            select: messageSelect,
          });
          if (existing) {
            assertMatchingReplay(existing);
            return { message: existing, replayed: true };
          }
        }

        if (attachmentIds.length) {
          const messageAttachments = await tx.attachment.findMany({
            where: {
              id: { in: attachmentIds },
              uploaderId: session.user.id,
              postId: null,
              messageId: null,
            },
            select: { storageKey: true, sizeBytes: true },
          });
          if (messageAttachments.length !== attachmentIds.length) {
            throw new ApiError(400, 'INVALID_ATTACHMENTS', '첨부 파일 정보가 올바르지 않습니다.');
          }
          assertAttachmentAllowedOnBoard('messages', messageAttachments);
        }

        const allocatedRoom = await tx.chatRoom.update({
          where: { id: roomId },
          data: { nextMessageSequence: { increment: BigInt(1) } },
          select: { nextMessageSequence: true },
        });
        const sequence = allocatedRoom.nextMessageSequence - BigInt(1);
        const created = await tx.message.create({
          data: {
            roomId,
            senderId: session.user.id,
            content,
            replyToId,
            clientId,
            sequence,
            requestHash: clientId ? requestHash : null,
          },
          select: messageSelect,
        });
        await bindEligibleAttachments(tx, {
          attachmentIds,
          uploaderId: session.user.id,
          binding: { messageId: created.id },
        });
        await tx.chatRoom.update({
          where: { id: roomId },
          data: { lastMessageAt: created.createdAt },
        });
        const recipients = await tx.chatMember.findMany({
          where: {
            roomId,
            leftAt: null,
            userId: { not: session.user.id },
            notificationsMuted: false,
            OR: [{ mutedUntil: null }, { mutedUntil: { lte: new Date() } }],
          },
          select: { userId: true },
        });
        if (recipients.length) {
          await createNotificationsWithDelivery(
            tx,
            recipients.map(({ userId }) => ({
              userId,
              actorId: session.user.id,
              type: 'MESSAGE',
              title: '새 메시지가 도착했습니다.',
              body: content.slice(0, 120),
              href: `/messages?roomId=${encodeURIComponent(roomId)}`,
              metadata: { roomId, messageId: created.id, sequence: sequence.toString() },
            })),
          );
        }
        const persistedMessage = attachmentIds.length
          ? await tx.message.findUniqueOrThrow({ where: { id: created.id }, select: messageSelect })
          : created;
        if (outboxPublicationEnabled()) {
          const serialized = serializeChatMessage(persistedMessage);
          await queueRealtimeEvent(
            tx,
            'message',
            toOutboxJson({
              roomId: persistedMessage.roomId,
              message: {
                ...serialized,
                _bSide: {
                  enabled: platformMode.bSideEnabled,
                  anonymousNickname: anonymousNickname(
                    persistedMessage.sender.id,
                    platformMode.bSideEpoch,
                  ),
                },
              },
            }),
            `realtime:message:${persistedMessage.id}`,
          );
        }
        return { message: persistedMessage, replayed: false };
      });
      message = result.message;
      replayed = result.replayed;
    } catch (error) {
      if (!clientId || !isUniqueConstraintError(error)) throw error;
      const existing = await prisma.message.findUnique({
        where: { clientId },
        select: messageSelect,
      });
      if (!existing) throw error;
      assertMatchingReplay(existing);
      message = existing;
      replayed = true;
      }
    }

    const serializedMessage = serializeChatMessage(message);
    const realtimeMessage = {
      ...serializedMessage,
      _bSide: {
        enabled: platformMode.bSideEnabled,
        anonymousNickname: anonymousNickname(message.sender.id, platformMode.bSideEpoch),
      },
    };
    const fromRealtimeGateway = isRealtimeGatewayRequest(request);
    if (!fromRealtimeGateway && !replayed) {
      await publishRealtimeEvent('message', {
        roomId: message.roomId,
        message: realtimeMessage,
      });
    }
    const deliveryHeaders = {
      'X-Realtime-Delivery': outboxPublicationEnabled() ? 'outbox' : 'direct',
    };
    if (fromRealtimeGateway) {
      return json(chatMessageEnvelope(realtimeMessage, replayed), 201, deliveryHeaders);
    }
    const publicMessage = await maskPublicIdentitiesWithMode(
      serializedMessage,
      session.user.id,
      platformMode,
    );
    return json(chatMessageEnvelope(publicMessage, replayed), 201, deliveryHeaders);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request, { allowRealtimeGateway: true });
    const session = await requireUser(request);
    const body = await readJson<{ roomId?: unknown; messageId?: unknown }>(request, 8_192);
    const roomId = requiredString(body.roomId, 'roomId', { max: 64 });
    const messageId = requiredString(body.messageId, 'messageId', { max: 64 });
    await requireMembership(roomId, session.user.id);
    const message = await prisma.message.findFirst({
      where: { id: messageId, roomId },
      select: { id: true, sequence: true },
    });
    if (!message) throw new ApiError(404, 'MESSAGE_NOT_FOUND', '메시지를 찾을 수 없습니다.');
    await prisma.chatMember.updateMany({
      where: {
        roomId,
        userId: session.user.id,
        lastReadSequence: { lt: message.sequence },
      },
      data: { lastReadMessageId: message.id, lastReadSequence: message.sequence },
    });
    const membership = await prisma.chatMember.findUniqueOrThrow({
      where: { roomId_userId: { roomId, userId: session.user.id } },
      select: { lastReadMessageId: true, lastReadSequence: true },
    });
    return json({
      read: true,
      roomId,
      messageId: membership.lastReadMessageId,
      lastReadSequence: membership.lastReadSequence.toString(),
    });
  } catch (error) {
    return jsonError(error);
  }
}
