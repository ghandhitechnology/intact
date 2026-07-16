'use client';

import {
  Badge,
  Button,
  Card,
  PageHeading,
  Toast,
  apiErrorMessage,
  readApiEnvelope,
} from '@/components/operations/ui';
import {
  SHOP_SLOT_LABELS,
  type ShopItem,
  type ShopSlot,
} from '@/lib/igk-shop';
import {
  ArrowLeft,
  Check,
  Coins,
  Loader2,
  Palette,
  ShieldCheck,
  ShoppingBag,
  Snowflake,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

type OwnedItem = { itemId: string; quantity: number; equipped: boolean };

type ShopData = {
  items: ShopItem[];
  owned: OwnedItem[];
  currentIgk: number;
};

const SLOT_ORDER: ShopSlot[] = ['nicknameColor', 'avatarRing', 'title', 'consumable'];

const SLOT_ICONS: Record<ShopSlot, typeof Palette> = {
  nicknameColor: Palette,
  avatarRing: ShieldCheck,
  title: Sparkles,
  consumable: Snowflake,
};

export default function IgkShopPage() {
  const [data, setData] = useState<ShopData | null>(null);
  const [failed, setFailed] = useState(false);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<'success' | 'error'>('success');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/igk/shop', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = await readApiEnvelope<ShopData>(response);
        if (!response.ok || !payload?.ok) throw new Error('상점 정보를 불러오지 못했습니다.');
        setData(payload.data);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setFailed(true);
      });
    return () => controller.abort();
  }, []);

  function ownedItem(itemId: string) {
    return data?.owned.find((entry) => entry.itemId === itemId) ?? null;
  }

  async function purchase(item: ShopItem) {
    if (!data || pendingItemId) return;
    setPendingItemId(item.id);
    try {
      const response = await fetch('/api/igk/shop/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id }),
      });
      const payload = await readApiEnvelope<{ itemId: string; quantity: number; balance: number }>(response);
      if (!response.ok || !payload?.ok) {
        throw new Error(apiErrorMessage(payload, '구매에 실패했습니다.'));
      }
      setData((current) => {
        if (!current) return current;
        const rest = current.owned.filter((entry) => entry.itemId !== item.id);
        const previous = current.owned.find((entry) => entry.itemId === item.id);
        return {
          ...current,
          currentIgk: payload.data.balance,
          owned: [
            ...rest,
            { itemId: item.id, quantity: payload.data.quantity, equipped: previous?.equipped ?? false },
          ],
        };
      });
      setToastTone('success');
      setToast(`${item.name}을(를) 구매했습니다.`);
    } catch (cause) {
      setToastTone('error');
      setToast(cause instanceof Error ? cause.message : '구매에 실패했습니다.');
    } finally {
      setPendingItemId(null);
    }
  }

  async function toggleEquip(item: ShopItem, equipped: boolean) {
    if (!data || pendingItemId) return;
    setPendingItemId(item.id);
    try {
      const response = await fetch('/api/igk/shop/equip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id, equipped }),
      });
      const payload = await readApiEnvelope<{ owned: OwnedItem[] }>(response);
      if (!response.ok || !payload?.ok) {
        throw new Error(apiErrorMessage(payload, '장착 변경에 실패했습니다.'));
      }
      setData((current) => (current ? { ...current, owned: payload.data.owned } : current));
      setToastTone('success');
      setToast(equipped ? `${item.name}을(를) 장착했습니다.` : `${item.name}을(를) 해제했습니다.`);
    } catch (cause) {
      setToastTone('error');
      setToast(cause instanceof Error ? cause.message : '장착 변경에 실패했습니다.');
    } finally {
      setPendingItemId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-4 sm:px-6 lg:px-8">
      <PageHeading
        title="IGK 상점"
        description="모은 IGK로 닉네임 색상, 아바타 테두리, 칭호를 꾸미고 스트릭 프리즈를 준비하세요. 구매는 보유 IGK만 사용하며 등급 누적에는 영향이 없습니다."
        actions={
          <Link href="/igk" className="inline-flex h-9 items-center gap-2 border border-slate-300 bg-white px-4 text-xs font-extrabold text-slate-700 hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" /> IGK 지갑
          </Link>
        }
      />

      {!data && !failed ? (
        <Card className="mt-4 grid min-h-40 place-items-center">
          <div className="text-center text-sm font-bold text-slate-600">
            <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-emerald-700" />
            상점을 여는 중
          </div>
        </Card>
      ) : null}

      {failed ? (
        <Card className="mt-4 p-8 text-center">
          <p className="text-sm font-bold text-slate-700">상점 정보를 불러오지 못했습니다.</p>
          <Button className="mt-4" onClick={() => window.location.reload()}>다시 시도</Button>
        </Card>
      ) : null}

      {data ? (
        <>
          <section className="mt-4 flex items-center justify-between border border-slate-200 bg-emerald-800 p-4 text-white">
            <div>
              <p className="text-xs font-bold text-emerald-100">보유 IGK</p>
              <p className="mt-1 flex items-center gap-2 text-2xl font-black">
                <Coins className="h-5 w-5" />
                {data.currentIgk.toLocaleString()}
              </p>
            </div>
            <ShoppingBag className="h-8 w-8 text-emerald-200" />
          </section>

          {SLOT_ORDER.map((slot) => {
            const slotItems = data.items.filter((item) => item.slot === slot);
            if (slotItems.length === 0) return null;
            const SlotIcon = SLOT_ICONS[slot];
            return (
              <section key={slot} className="mt-6">
                <h2 className="flex items-center gap-2 text-sm font-black text-slate-950">
                  <SlotIcon className="h-4 w-4 text-emerald-700" />
                  {SHOP_SLOT_LABELS[slot]}
                  {slot !== 'consumable' ? (
                    <span className="text-[11px] font-bold text-slate-400">동시에 1개만 장착</span>
                  ) : null}
                </h2>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {slotItems.map((item) => {
                    const owned = ownedItem(item.id);
                    const quantity = owned?.quantity ?? 0;
                    const isPending = pendingItemId === item.id;
                    const maxed = item.consumable && quantity >= (item.maxQuantity ?? 1);
                    const canBuy = item.consumable ? !maxed : !owned;
                    return (
                      <article key={item.id} className="flex flex-col justify-between border border-slate-200 bg-white p-4">
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <p className="flex min-w-0 items-center gap-2 text-sm font-black text-slate-950">
                              {item.slot === 'nicknameColor' && item.color ? (
                                <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                              ) : null}
                              <span className="truncate" style={item.slot === 'nicknameColor' && item.color ? { color: item.color } : undefined}>
                                {item.name}
                              </span>
                            </p>
                            {owned?.equipped ? <Badge tone="green">장착 중</Badge> : null}
                            {item.consumable && quantity > 0 ? <Badge tone="slate">{quantity}개 보유</Badge> : null}
                            {!item.consumable && owned && !owned.equipped ? <Badge tone="slate">보유</Badge> : null}
                          </div>
                          <p className="mt-2 text-xs leading-5 text-slate-500">{item.description}</p>
                        </div>
                        <div className="mt-4 flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1 text-sm font-black text-slate-900">
                            <Coins className="h-4 w-4 text-amber-600" />
                            {item.price.toLocaleString()}
                          </span>
                          <div className="flex items-center gap-2">
                            {!item.consumable && owned ? (
                              <Button
                                variant={owned.equipped ? 'secondary' : 'primary'}
                                onClick={() => void toggleEquip(item, !owned.equipped)}
                                disabled={isPending}
                              >
                                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                {owned.equipped ? '해제' : '장착'}
                              </Button>
                            ) : null}
                            {canBuy ? (
                              <Button
                                onClick={() => void purchase(item)}
                                disabled={isPending || data.currentIgk < item.price}
                              >
                                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingBag className="h-4 w-4" />}
                                {data.currentIgk < item.price ? 'IGK 부족' : '구매'}
                              </Button>
                            ) : null}
                            {maxed ? <Badge tone="amber">최대 보유</Badge> : null}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}

          <p className="mt-6 text-xs leading-5 text-slate-500">
            익명 모드(B-side)에서는 다른 사람에게 꾸미기 효과가 표시되지 않습니다. 스트릭 프리즈는 출석을 하루 놓쳤을 때 다음 출석에서 자동으로 사용됩니다.
          </p>
        </>
      ) : null}

      <Toast message={toast} tone={toastTone} onClose={() => setToast(null)} />
    </div>
  );
}
