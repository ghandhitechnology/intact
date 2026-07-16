import prisma from '@/lib/prisma';
import { SHOP_ITEMS, shopItemById } from '@/lib/igk-shop';
import {
  ApiError,
  assertSameOrigin,
  json,
  jsonError,
  readJson,
  requiredString,
} from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';

interface EquipBody {
  itemId?: unknown;
  equipped?: unknown;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    const body = await readJson<EquipBody>(request, 4_096);
    const itemId = requiredString(body.itemId, '아이템', { min: 1, max: 60 });
    if (typeof body.equipped !== 'boolean') {
      throw new ApiError(400, 'VALIDATION_ERROR', '장착 여부 값을 입력해 주세요.');
    }
    const equipped = body.equipped;
    const item = shopItemById(itemId);
    if (!item) throw new ApiError(404, 'ITEM_NOT_FOUND', '존재하지 않는 상점 아이템입니다.');
    if (item.consumable) {
      throw new ApiError(400, 'NOT_EQUIPPABLE', '소모품은 장착할 수 없습니다.');
    }

    const owned = await prisma.$transaction(async (tx) => {
      const target = await tx.userItem.findUnique({
        where: { userId_itemId: { userId: session.user.id, itemId: item.id } },
        select: { id: true },
      });
      if (!target) {
        throw new ApiError(404, 'ITEM_NOT_OWNED', '보유하지 않은 아이템입니다.');
      }
      if (equipped) {
        const sameSlotIds = SHOP_ITEMS
          .filter((candidate) => candidate.slot === item.slot && candidate.id !== item.id)
          .map((candidate) => candidate.id);
        await tx.userItem.updateMany({
          where: { userId: session.user.id, itemId: { in: sameSlotIds }, equipped: true },
          data: { equipped: false },
        });
      }
      await tx.userItem.update({
        where: { id: target.id },
        data: { equipped },
      });
      return tx.userItem.findMany({
        where: { userId: session.user.id },
        select: { itemId: true, quantity: true, equipped: true },
      });
    });
    return json({ owned });
  } catch (error) {
    return jsonError(error);
  }
}
