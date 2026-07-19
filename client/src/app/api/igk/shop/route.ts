import prisma from '@/lib/prisma';
import { isShopItemAvailable, seoulShopSeason, SHOP_ITEMS } from '@/lib/igk-shop';
import { json, jsonError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';
import { standingFor, topIgkRankMap } from '@/lib/server/igk-standing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const [user, owned, rankMap] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: session.user.id },
        select: { currentIgk: true, level: true },
      }),
      prisma.userItem.findMany({
        where: { userId: session.user.id },
        select: { itemId: true, quantity: true, equipped: true },
      }),
      topIgkRankMap(),
    ]);
    return json({
      items: SHOP_ITEMS.map((item) => ({ ...item, available: isShopItemAvailable(item) })),
      owned,
      currentIgk: user.currentIgk,
      standing: standingFor(user.level, rankMap.get(session.user.id) ?? null),
      activeSeason: seoulShopSeason(),
    });
  } catch (error) {
    return jsonError(error);
  }
}
