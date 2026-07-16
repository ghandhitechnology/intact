import prisma from '@/lib/prisma';
import { ApiError, assertSameOrigin, json, jsonError, readJson } from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';

interface ReadBody {
  messageId?: unknown;
  sequence?: unknown;
}

function optionalSequence(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = typeof value === 'bigint' ? value.toString() : String(value);
  if (!/^(0|[1-9]\d*)$/.test(normalized)) {
    throw new ApiError(400, 'INVALID_SEQUENCE', '읽음 순서가 올바르지 않습니다.');
  }
  return BigInt(normalized);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    assertSameOrigin(request);
    const session = await requireUser(request);
    const body = await readJson<ReadBody>(request);
    const messageId = typeof body.messageId === 'string' && body.messageId.trim()
      ? body.messageId.trim().slice(0, 64)
      : null;
    const requestedSequence = optionalSequence(body.sequence);
    if (!messageId && requestedSequence === null) {
      throw new ApiError(400, 'READ_TARGET_REQUIRED', '읽은 메시지 또는 순서를 입력해 주세요.');
    }

    const membership = await prisma.chatMember.findUnique({
      where: { roomId_userId: { roomId: id, userId: session.user.id } },
      select: { leftAt: true },
    });
    if (!membership || membership.leftAt) {
      throw new ApiError(403, 'NOT_A_ROOM_MEMBER', '이 대화방에 참여하고 있지 않습니다.');
    }

    const message = messageId
      ? await prisma.message.findFirst({
          where: { id: messageId, roomId: id },
          select: { id: true, sequence: true },
        })
      : await prisma.message.findUnique({
          where: { roomId_sequence: { roomId: id, sequence: requestedSequence! } },
          select: { id: true, sequence: true },
        });
    if (!message || (requestedSequence !== null && message.sequence !== requestedSequence)) {
      throw new ApiError(404, 'MESSAGE_NOT_FOUND', '메시지를 찾을 수 없습니다.');
    }

    await prisma.chatMember.updateMany({
      where: {
        roomId: id,
        userId: session.user.id,
        leftAt: null,
        lastReadSequence: { lt: message.sequence },
      },
      data: {
        lastReadMessageId: message.id,
        lastReadSequence: message.sequence,
      },
    });
    const updated = await prisma.chatMember.findUniqueOrThrow({
      where: { roomId_userId: { roomId: id, userId: session.user.id } },
      select: { lastReadMessageId: true, lastReadSequence: true },
    });
    return json({
      readThrough: updated.lastReadMessageId,
      lastReadSequence: updated.lastReadSequence.toString(),
    });
  } catch (error) {
    return jsonError(error);
  }
}
