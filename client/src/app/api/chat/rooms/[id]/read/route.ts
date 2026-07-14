import prisma from '@/lib/prisma';
import { ApiError, assertSameOrigin, json, jsonError, readJson, requiredString } from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    assertSameOrigin(request);
    const session = await requireUser(request);
    const body = await readJson<{ messageId?: unknown }>(request);
    const messageId = requiredString(body.messageId, 'messageId', { max: 64 });
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { roomId: true },
    });
    if (!message || message.roomId !== id) {
      throw new ApiError(404, 'MESSAGE_NOT_FOUND', '메시지를 찾을 수 없습니다.');
    }
    const membership = await prisma.chatMember.findUnique({
      where: { roomId_userId: { roomId: id, userId: session.user.id } },
    });
    if (!membership || membership.leftAt) {
      throw new ApiError(403, 'NOT_A_ROOM_MEMBER', '이 대화방에 참여하고 있지 않습니다.');
    }
    await prisma.chatMember.update({
      where: { roomId_userId: { roomId: id, userId: session.user.id } },
      data: { lastReadMessageId: messageId },
    });
    return json({ readThrough: messageId });
  } catch (error) {
    return jsonError(error);
  }
}
