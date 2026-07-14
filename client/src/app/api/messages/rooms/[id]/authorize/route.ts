import prisma from '@/lib/prisma';
import { ApiError, json, jsonError } from '@/lib/server/http';
import { publicUser, requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Compatibility endpoint for the realtime service room-join handshake. */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const session = await requireUser(request);
    const membership = await prisma.chatMember.findUnique({
      where: { roomId_userId: { roomId: id, userId: session.user.id } },
      select: { role: true, leftAt: true },
    });
    if (!membership || membership.leftAt) {
      throw new ApiError(403, 'NOT_A_ROOM_MEMBER', '이 대화방에 참여하고 있지 않습니다.');
    }
    return json({
      authorized: true,
      roomId: id,
      membership,
      user: publicUser(session.user),
    });
  } catch (error) {
    return jsonError(error);
  }
}
