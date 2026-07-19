import { randomUUID } from 'node:crypto';
import prisma from '@/lib/prisma';
import { isShopItemAvailable, shopItemById } from '@/lib/igk-shop';
import { lockIgkAccounts, spendIgk } from '@/lib/server/igk';
import {
  ApiError,
  assertSameOrigin,
  json,
  jsonError,
  readJson,
  requiredString,
} from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';
import { isRetryableTransactionError } from '@/lib/server/transactions';
import { standingFor, topIgkRankMap } from '@/lib/server/igk-standing';

export const runtime = 'nodejs';

interface PurchaseBody {
  itemId?: unknown;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    const body = await readJson<PurchaseBody>(request, 4_096);
    const itemId = requiredString(body.itemId, '아이템', { min: 1, max: 60 });
    const item = shopItemById(itemId);
    if (!item) throw new ApiError(404, 'ITEM_NOT_FOUND', '존재하지 않는 상점 아이템입니다.');
    if (!isShopItemAvailable(item)) {
      throw new ApiError(409, 'ITEM_NOT_AVAILABLE', '현재 시즌에는 구매할 수 없는 아이템입니다.');
    }

    // Non-consumables can be bought once, so a stable key makes retries safe.
    // Consumable purchases use the caller's Idempotency-Key (or a fresh UUID).
    const requestKey = request.headers.get('idempotency-key')?.trim().slice(0, 80) || randomUUID();
    const idempotencyKey = item.consumable
      ? `shop:${session.user.id}:${item.id}:${requestKey}`
      : `shop:${session.user.id}:${item.id}`;

    let result: { itemId: string; quantity: number; balance: number } | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await prisma.$transaction(
          async (tx) => {
            await lockIgkAccounts(tx, [session.user.id]);
            const existing = await tx.userItem.findUnique({
              where: { userId_itemId: { userId: session.user.id, itemId: item.id } },
              select: { quantity: true },
            });
            const completed = await tx.igkLedger.findUnique({
              where: { idempotencyKey },
              select: { balanceAfter: true },
            });
            if (completed) {
              // Replay of an already-settled purchase: never charge or grant twice.
              return {
                itemId: item.id,
                quantity: existing?.quantity ?? 0,
                balance: completed.balanceAfter,
              };
            }
            if (!item.consumable && existing) {
              throw new ApiError(409, 'ALREADY_OWNED', '이미 보유한 아이템입니다.');
            }
            const maxQuantity = item.maxQuantity ?? 1;
            if (item.consumable && (existing?.quantity ?? 0) >= maxQuantity) {
              throw new ApiError(
                400,
                'MAX_QUANTITY',
                `이 아이템은 최대 ${maxQuantity}개까지 보유할 수 있습니다.`,
              );
            }

            const ledger = await spendIgk(tx, {
              userId: session.user.id,
              amount: item.price,
              type: 'SHOP_PURCHASE',
              idempotencyKey,
              sourceType: 'shop-item',
              sourceId: item.id,
              note: `${item.name} 구매`,
            });

            const owned = await tx.userItem.upsert({
              where: { userId_itemId: { userId: session.user.id, itemId: item.id } },
              create: { userId: session.user.id, itemId: item.id, quantity: 1 },
              update: item.consumable ? { quantity: { increment: 1 } } : {},
              select: { quantity: true },
            });
            return {
              itemId: item.id,
              quantity: owned.quantity,
              balance: ledger.balanceAfter,
            };
          },
          { isolationLevel: 'Serializable' },
        );
        break;
      } catch (error) {
        if (attempt < 2 && isRetryableTransactionError(error)) continue;
        throw error;
      }
    }
    const [user, rankMap] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: session.user.id },
        select: { level: true },
      }),
      topIgkRankMap(),
    ]);
    return json({
      ...result!,
      standing: standingFor(user.level, rankMap.get(session.user.id) ?? null),
    });
  } catch (error) {
    return jsonError(error);
  }
}
