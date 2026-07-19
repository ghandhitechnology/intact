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
      where: { members: { some: { userId: session.user.id, leftAt: null } } },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
    });
    return json({ rooms });
  } catch (error) {
    return jsonError(error);
  }
}
