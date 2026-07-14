import prisma from '@/lib/prisma';
import { json, jsonError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** @deprecated Use GET /api/chat/rooms. */
export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const rooms = await prisma.chatRoom.findMany({
      where: { type: 'DIRECT', members: { some: { userId: session.user.id, leftAt: null } } },
      orderBy: { lastMessageAt: 'desc' },
      take: 50,
      include: {
        members: {
          where: { leftAt: null },
          select: { user: { select: { id: true, nickname: true, realName: true, profileImage: true } } },
        },
      },
    });
    return json({ rooms });
  } catch (error) {
    return jsonError(error);
  }
}
