import prisma from '@/lib/prisma';
import { SHOP_ITEMS } from '@/lib/igk-shop';
import { json, jsonError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const [user, owned] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: session.user.id },
        select: { currentIgk: true },
      }),
      prisma.userItem.findMany({
        where: { userId: session.user.id },
        select: { itemId: true, quantity: true, equipped: true },
      }),
    ]);
    return json({
      items: SHOP_ITEMS,
      owned,
      currentIgk: user.currentIgk,
    });
  } catch (error) {
    return jsonError(error);
  }
}
