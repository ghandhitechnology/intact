'use client';

import { Badge, Button, Card, Modal, PageHeading, Tabs, Toast, apiErrorMessage, readApiEnvelope } from '@/components/operations/ui';
import { igkLevelForBalance, type IgkStanding } from '@/lib/igk-levels';
import { SHOP_SLOT_LABELS, type ShopCollection, type ShopItem, type ShopSlot } from '@/lib/igk-shop';
import { ArrowLeft, Check, Coins, FileSignature, FlaskConical, LayoutTemplate, Loader2, Palette, ShieldCheck, ShoppingBag, Snowflake, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type AvailableShopItem = ShopItem & { available: boolean };
type OwnedItem = { itemId: string; quantity: number; equipped: boolean };
type ShopData = { items: AvailableShopItem[]; owned: OwnedItem[]; currentIgk: number; standing: IgkStanding; activeSeason: Exclude<ShopCollection, 'core'> };

const SLOT_ORDER: ShopSlot[] = ['nicknameColor', 'avatarRing', 'title', 'profileTheme', 'postAccent', 'consumable'];
const SLOT_ICONS: Record<ShopSlot, typeof Palette> = { nicknameColor: Palette, avatarRing: ShieldCheck, title: Sparkles, profileTheme: LayoutTemplate, postAccent: FileSignature, consumable: Snowflake };
const SEASON_LABELS: Record<Exclude<ShopCollection, 'core'>, string> = { spring: '봄', summer: '여름', autumn: '가을', winter: '겨울' };

function ItemPreview({ item }: { item: ShopItem }) {
  if (item.slot === 'avatarRing') return <div className="grid h-24 place-items-center rounded-xl bg-slate-50"><div className={`grid h-12 w-12 place-items-center rounded-full border bg-white text-xs font-black text-slate-600 ${item.ringClass ?? ''}`}>IG</div></div>;
  if (item.slot === 'profileTheme') return <div className={`h-24 rounded-xl border border-slate-200 p-3 ${item.profileThemeClass ?? ''}`}><div className="h-2 w-20 rounded-full bg-current opacity-25" /><div className="mt-2 h-2 w-12 rounded-full bg-current opacity-15" /></div>;
  if (item.slot === 'postAccent') return <div className={`h-24 rounded-xl border border-slate-200 bg-white p-3 ${item.postAccentClass ?? ''}`}><div className="h-2 w-24 rounded-full bg-slate-200" /><div className="mt-3 h-2 w-full rounded-full bg-slate-100" /></div>;
  return <div className="grid h-24 place-items-center rounded-xl border border-slate-100 bg-slate-50 px-3 text-center"><span className="text-sm font-black" style={item.slot === 'nicknameColor' ? { color: item.color } : undefined}>{item.slot === 'title' ? `[ ${item.name} ]` : item.slot === 'consumable' ? '출석 스트릭 보호' : '인곽 탐구자'}</span></div>;
}

export default function IgkShopPage() {
  const [data, setData] = useState<ShopData | null>(null);
  const [failed, setFailed] = useState(false);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [purchaseTarget, setPurchaseTarget] = useState<AvailableShopItem | null>(null);
  const [collection, setCollection] = useState<'all' | 'core' | 'season'>('all');
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<'success' | 'error'>('success');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/igk/shop', { cache: 'no-store', signal: controller.signal }).then(async (response) => {
      const payload = await readApiEnvelope<ShopData>(response);
      if (!response.ok || !payload?.ok) throw new Error('상점 정보를 불러오지 못했습니다.');
      setData(payload.data);
    }).catch((error) => { if (!(error instanceof DOMException && error.name === 'AbortError')) setFailed(true); });
    return () => controller.abort();
  }, []);

  const filteredItems = useMemo(() => {
    if (!data) return [];
    return data.items.filter((item) => {
      const owned = data.owned.some((entry) => entry.itemId === item.id);
      if (collection === 'core' && item.collection !== 'core') return false;
      if (collection === 'season' && item.collection !== data.activeSeason) return false;
      if (ownedOnly && !owned) return false;
      return item.collection === 'core' || item.collection === data.activeSeason || owned;
    });
  }, [collection, data, ownedOnly]);

  function ownedItem(itemId: string) { return data?.owned.find((entry) => entry.itemId === itemId) ?? null; }

  async function purchase(item: AvailableShopItem) {
    if (!data || pendingItemId) return;
    setPendingItemId(item.id);
    try {
      const response = await fetch('/api/igk/shop/purchase', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ itemId: item.id }) });
      const payload = await readApiEnvelope<{ itemId: string; quantity: number; balance: number; standing: IgkStanding }>(response);
      if (!response.ok || !payload?.ok) throw new Error(apiErrorMessage(payload, '구매에 실패했습니다.'));
      setData((current) => current ? { ...current, currentIgk: payload.data.balance, standing: payload.data.standing, owned: [...current.owned.filter((entry) => entry.itemId !== item.id), { itemId: item.id, quantity: payload.data.quantity, equipped: current.owned.find((entry) => entry.itemId === item.id)?.equipped ?? false }] } : current);
      setPurchaseTarget(null); setToastTone('success'); setToast(`${item.name}을(를) 구매했습니다.`);
    } catch (cause) { setToastTone('error'); setToast(cause instanceof Error ? cause.message : '구매에 실패했습니다.'); }
    finally { setPendingItemId(null); }
  }

  async function toggleEquip(item: ShopItem, equipped: boolean) {
    if (!data || pendingItemId) return;
    setPendingItemId(item.id);
    try {
      const response = await fetch('/api/igk/shop/equip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: item.id, equipped }) });
      const payload = await readApiEnvelope<{ owned: OwnedItem[] }>(response);
      if (!response.ok || !payload?.ok) throw new Error(apiErrorMessage(payload, '장착 변경에 실패했습니다.'));
      setData((current) => current ? { ...current, owned: payload.data.owned } : current);
      setToastTone('success'); setToast(equipped ? `${item.name}을(를) 장착했습니다.` : `${item.name}을(를) 해제했습니다.`);
    } catch (cause) { setToastTone('error'); setToast(cause instanceof Error ? cause.message : '장착 변경에 실패했습니다.'); }
    finally { setPendingItemId(null); }
  }

  const afterBalance = data && purchaseTarget ? data.currentIgk - purchaseTarget.price : null;
  const afterTier = afterBalance == null ? null : igkLevelForBalance(afterBalance);
  const downgrade = Boolean(data && afterTier && afterTier.level < data.standing.level);

  return <div className="app-page mx-auto w-full max-w-[1200px] px-4 py-4 sm:px-6 lg:px-8">
    <PageHeading title="IGK 상점" actions={<Link href="/igk" className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 shadow-[var(--shadow-xs)] transition-colors duration-150 hover:border-slate-300 hover:bg-slate-50 hover:shadow-[var(--shadow-sm)]"><ArrowLeft className="h-4 w-4" /> IGK 지갑</Link>} />
    {!data && !failed ? <div className="mt-4 space-y-4" aria-busy="true"><p className="sr-only">상점을 여는 중</p><div className="skeleton h-24 rounded-2xl" /><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((item) => <div key={item} className="skeleton h-56 rounded-2xl" />)}</div></div> : null}
    {failed ? <Card className="anim-rise mt-4 p-10 text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-slate-400"><ShoppingBag className="h-6 w-6" /></span><p className="mt-4 text-sm font-bold text-slate-700">상점 정보를 불러오지 못했습니다.</p><Button className="mt-5" onClick={() => window.location.reload()}>다시 시도</Button></Card> : null}

    {data ? <>
      <section className="anim-rise mt-4 grid overflow-hidden rounded-2xl shadow-[var(--shadow-sm)] sm:grid-cols-[1fr_auto]"><div className="bg-emerald-800 p-5 text-white"><p className="text-xs font-bold text-emerald-100">보유 IGK · {data.standing.tierLabel}{data.standing.rankLabel ? ` · ${data.standing.rankLabel}` : ''}</p><p className="mt-1.5 flex items-center gap-2 text-[28px] font-bold leading-none tabular-nums"><Coins className="h-5 w-5" />{data.currentIgk.toLocaleString()}</p></div><div className="flex min-w-64 items-center gap-3 bg-emerald-900 px-5 py-4 text-sm text-emerald-50"><FlaskConical className="h-5 w-5 shrink-0" /><p className="font-bold">{SEASON_LABELS[data.activeSeason]} 컬렉션 판매 중</p></div></section>
      <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="상점 필터"><Tabs items={([['all', '전체'], ['core', '상시'], ['season', `${SEASON_LABELS[data.activeSeason]} 한정`]] as const).map(([value, label]) => ({ value, label }))} value={collection} onChange={setCollection} className="w-full sm:w-auto" /><Button className="shrink-0" variant={ownedOnly ? 'primary' : 'secondary'} onClick={() => setOwnedOnly((value) => !value)}><Check className="h-4 w-4" />보유/장착만</Button></div>

      {SLOT_ORDER.map((slot) => {
        const slotItems = filteredItems.filter((item) => item.slot === slot);
        if (!slotItems.length) return null;
        const SlotIcon = SLOT_ICONS[slot];
        return <section key={slot} className="mt-7"><h2 className="flex items-center gap-2 text-sm font-bold tracking-[-0.01em] text-slate-950"><SlotIcon className="h-4 w-4 text-emerald-700" />{SHOP_SLOT_LABELS[slot]}{slot !== 'consumable' ? <span className="text-xs font-semibold text-slate-400">슬롯당 1개 장착</span> : null}</h2><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{slotItems.map((item) => {
          const owned = ownedItem(item.id); const quantity = owned?.quantity ?? 0; const isPending = pendingItemId === item.id; const maxed = item.consumable && quantity >= (item.maxQuantity ?? 1); const canBuy = item.consumable ? !maxed : !owned;
          return <article key={item.id} className="flex flex-col rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[var(--shadow-xs)] transition-colors duration-150 hover:shadow-[var(--shadow-md)]"><ItemPreview item={item} /><div className="mt-3 flex items-start justify-between gap-2"><div><p className="text-sm font-black text-slate-950">{item.name}</p><p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{item.collection === 'core' ? '상시' : `${SEASON_LABELS[item.collection]} 한정`} · {item.rarity}</p></div><div className="flex flex-wrap justify-end gap-1">{owned?.equipped ? <Badge tone="green">장착 중</Badge> : null}{owned && !owned.equipped ? <Badge tone="slate">보유 {item.consumable ? quantity : ''}</Badge> : null}{!item.available && owned ? <Badge tone="amber">판매 종료</Badge> : null}</div></div><div className="mt-4 flex flex-col gap-3 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between"><span className="inline-flex items-center gap-1 text-sm font-bold tabular-nums text-slate-900"><Coins className="h-4 w-4 text-amber-600" />{item.price.toLocaleString()}</span><div className="grid grid-cols-2 items-center gap-2 min-[360px]:flex">{!item.consumable && owned ? <Button variant={owned.equipped ? 'secondary' : 'primary'} onClick={() => void toggleEquip(item, !owned.equipped)} disabled={isPending}>{isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{owned.equipped ? '해제' : '장착'}</Button> : null}{canBuy ? <Button onClick={() => setPurchaseTarget(item)} disabled={isPending || data.currentIgk < item.price || !item.available}>{!item.available ? '판매 종료' : data.currentIgk < item.price ? 'IGK 부족' : '구매'}</Button> : null}{maxed ? <Badge tone="amber">최대 보유</Badge> : null}</div></div></article>;
        })}</div></section>;
      })}
      {!filteredItems.length ? <Card className="mt-6 p-10 text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-slate-400"><ShoppingBag className="h-6 w-6" /></span><p className="mt-4 text-sm text-slate-500">조건에 맞는 아이템이 없습니다.</p></Card> : null}
    </> : null}

    <Modal open={Boolean(purchaseTarget)} title="구매 확인" onClose={() => !pendingItemId && setPurchaseTarget(null)} footer={<><Button variant="secondary" onClick={() => setPurchaseTarget(null)} disabled={Boolean(pendingItemId)}>취소</Button><Button onClick={() => purchaseTarget && void purchase(purchaseTarget)} disabled={Boolean(pendingItemId)}>{pendingItemId ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingBag className="h-4 w-4" />}구매 확정</Button></>}>
      {purchaseTarget && data && afterBalance != null && afterTier ? <div><ItemPreview item={purchaseTarget} /><div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 text-sm"><div className="bg-white p-3.5"><p className="text-xs text-slate-500">현재</p><p className="mt-1 font-black tabular-nums">{data.currentIgk.toLocaleString()} IGK</p><p className="text-xs">{data.standing.tierLabel}</p></div><div className="bg-white p-3.5"><p className="text-xs text-slate-500">구매 후</p><p className="mt-1 font-black tabular-nums">{afterBalance.toLocaleString()} IGK</p><p className="text-xs">{afterTier.label}</p></div></div>{downgrade ? <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-900">구매하면 현재 IGK가 임계값 아래로 내려가 {data.standing.tierLabel}에서 {afterTier.label}(으)로 등급이 내려갑니다. 짱 순위도 변경될 수 있습니다.</p> : null}</div> : <div />}
    </Modal>
    <Toast message={toast} tone={toastTone} onClose={() => setToast(null)} />
  </div>;
}
