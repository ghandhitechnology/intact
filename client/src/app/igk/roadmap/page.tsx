'use client';

import { Badge, Button, Card, PageHeading, Progress, readApiEnvelope } from '@/components/operations/ui';
import { IGK_LEVELS, igkLevelForBalance, type IgkStanding } from '@/lib/igk-levels';
import { ArrowLeft, Check, Coins, GraduationCap, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

type Wallet = {
  currentIgk: number;
  lifetimeIgk: number;
  level: number;
  standing: IgkStanding;
};

export default function IgkRoadmapPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/igk/balance', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = await readApiEnvelope<Wallet>(response);
        if (!response.ok || !payload?.ok) throw new Error('등급 정보를 불러오지 못했습니다.');
        setWallet(payload.data);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setFailed(true);
      });
    return () => controller.abort();
  }, []);

  const currentRule = igkLevelForBalance(wallet?.currentIgk ?? 0);
  const nextRule = IGK_LEVELS.find((rule) => rule.level > currentRule.level) ?? null;
  const previousThreshold = currentRule.minimumCurrentIgk;
  const nextThreshold = nextRule?.minimumCurrentIgk ?? previousThreshold;
  const segmentProgress = nextRule && wallet
    ? Math.min(100, Math.max(0, ((wallet.currentIgk - previousThreshold) / (nextThreshold - previousThreshold)) * 100))
    : 100;

  return (
    <div className="app-page mx-auto w-full max-w-[1200px] px-4 py-4 sm:px-6 lg:px-8">
      <PageHeading
        title="등급 로드맵"
        actions={
          <Link href="/igk" className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 shadow-[var(--shadow-xs)] transition-colors duration-150 hover:border-slate-300 hover:bg-slate-50 hover:shadow-[var(--shadow-sm)]">
            <ArrowLeft className="h-4 w-4" /> IGK 지갑
          </Link>
        }
      />

      {!wallet && !failed ? (
        <div className="mt-4 space-y-4" aria-busy="true">
          <p className="sr-only">등급을 확인하는 중</p>
          <div className="skeleton h-24 rounded-2xl" />
          <div className="skeleton h-14 rounded-2xl" />
          <div className="grid gap-2 md:grid-cols-2">
            {[0, 1, 2, 3, 4, 5].map((item) => (
              <div key={item} className="skeleton h-[72px] rounded-2xl" />
            ))}
          </div>
        </div>
      ) : null}

      {failed ? (
        <Card className="anim-rise mt-4 p-10 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-slate-400">
            <GraduationCap className="h-6 w-6" />
          </span>
          <p className="mt-4 text-sm font-bold text-slate-700">등급 정보를 불러오지 못했습니다.</p>
          <Button className="mt-5" onClick={() => window.location.reload()}>다시 시도</Button>
        </Card>
      ) : null}

      {wallet ? (
        <>
          <section className="anim-rise mt-4 grid gap-px overflow-hidden rounded-2xl border border-slate-200/90 bg-slate-200 shadow-[var(--shadow-xs)] md:grid-cols-[1.1fr_1fr_1fr]">
            <div className="bg-emerald-800 p-5 text-white">
              <p className="text-xs font-bold text-emerald-100">현재 등급</p>
              <div className="mt-2 flex flex-wrap gap-2"><Badge tone="green">{wallet.standing.tierLabel}</Badge>{wallet.standing.rankLabel ? <Badge tone="blue">{wallet.standing.rankLabel}</Badge> : null}</div>
            </div>
            <div className="bg-white p-5">
              <p className="text-xs font-bold text-slate-500">현재 IGK</p>
              <p className="mt-2 text-xl font-bold tabular-nums tracking-[-0.02em] text-slate-950">{wallet.currentIgk.toLocaleString()}</p>
              <p className="mt-1 text-xs text-slate-500">선물·구매·회수 시 즉시 변동</p>
            </div>
            <div className="bg-white p-5">
              <p className="text-xs font-bold text-slate-500">다음 목표</p>
              <p className="mt-2 text-xl font-bold tracking-[-0.02em] text-slate-950">{nextRule?.label ?? '최고 등급'}</p>
              <p className="mt-1 text-xs text-slate-500">
                {nextRule ? `${Math.max(0, nextRule.minimumCurrentIgk - wallet.currentIgk).toLocaleString()} IGK 남음` : '최종 등급 도달'}
              </p>
            </div>
          </section>

          <Card className="anim-rise anim-delay-1 mt-4 p-5">
            <div className="flex items-center justify-between gap-4 text-xs font-bold text-slate-600">
              <span>{wallet.standing.tierLabel}</span>
              <span>{nextRule?.label ?? '조졸'}</span>
            </div>
            <div className="mt-3"><Progress value={segmentProgress} tone="green" /></div>
          </Card>

          <section className="anim-rise anim-delay-2 mt-4 rounded-2xl border border-blue-100 bg-blue-50/60 px-5 py-4">
            <p className="text-xs font-semibold text-blue-800">독립 짱 랭킹</p>
            <div className="mt-2 flex gap-2"><Badge tone="green">{wallet.standing.tierLabel}</Badge>{wallet.standing.rankLabel ? <Badge tone="blue">{wallet.standing.rankLabel}</Badge> : <Badge tone="slate">상위 10명 밖</Badge>}</div>
          </section>

          <div className="stagger mt-4 grid gap-2 md:grid-cols-2">
            {IGK_LEVELS.map((rule, index) => {
              const complete = wallet.level >= rule.level;
              const current = wallet.level === rule.level;
              const topTier = rule.level >= 10;
              return (
                <article
                  key={rule.level}
                  className={`grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border p-4 transition-colors duration-150 ${
                    current
                      ? 'border-emerald-300 bg-emerald-50/70 shadow-[var(--shadow-sm)] ring-1 ring-emerald-200'
                      : complete
                        ? 'border-slate-200/90 bg-white shadow-[var(--shadow-xs)]'
                        : 'border-slate-200/70 bg-slate-50/60'
                  }`}
                >
                  <span className={`grid h-10 w-10 place-items-center rounded-full ${topTier ? 'bg-slate-950 text-white' : complete ? 'bg-emerald-700 text-white shadow-[var(--shadow-xs)]' : 'bg-white text-slate-400 border border-slate-200'}`}>
                    {topTier ? <GraduationCap className="h-5 w-5" /> : complete ? <Check className="h-5 w-5" /> : <span className="text-sm font-bold tabular-nums">{index + 1}</span>}
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <strong className="text-base font-bold tracking-[-0.01em] text-slate-950">{rule.label}</strong>
                      {current ? <Badge tone="green">현재</Badge> : null}
                      {topTier ? <Trophy className="h-4 w-4 text-amber-600" /> : null}
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">보유 <span className="tabular-nums">{rule.minimumCurrentIgk.toLocaleString()}</span> IGK부터</span>
                  </span>
                  <Coins className={`h-5 w-5 ${complete ? 'text-emerald-700' : 'text-slate-300'}`} />
                </article>
              );
            })}
          </div>

        </>
      ) : null}
    </div>
  );
}
