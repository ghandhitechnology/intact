import prisma from '@/lib/prisma';
import { ApiError, json, jsonError, readJson, requiredString } from '@/lib/server/http';
import { publicUser, requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';

/** Read-only authorization handshake for the realtime gateway. */
export async function POST(request: Request) {
  try {
    const session = await requireUser(request);
    const body = await readJson<{ roomId?: unknown }>(request, 4_096);
    const roomId = requiredString(body.roomId, 'roomId', { max: 64 });
    const membership = await prisma.chatMember.findUnique({
      where: { roomId_userId: { roomId, userId: session.user.id } },
      select: { role: true, leftAt: true, mutedUntil: true },
    });
    if (!membership || membership.leftAt) {
      throw new ApiError(403, 'NOT_A_ROOM_MEMBER', '이 대화방에 참여하고 있지 않습니다.');
    }
    return json({ authorized: true, roomId, membership, user: publicUser(session.user) });
  } catch (error) {
    return jsonError(error);
  }
}
