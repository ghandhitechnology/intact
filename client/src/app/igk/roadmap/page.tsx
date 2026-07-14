'use client';

import { Badge, Button, Card, PageHeading, Progress, readApiEnvelope } from '@/components/operations/ui';
import { IGK_LEVELS, igkLevelForLifetime } from '@/lib/igk-levels';
import { ArrowLeft, Check, Coins, GraduationCap, Loader2, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

type Wallet = {
  currentIgk: number;
  lifetimeIgk: number;
  level: number;
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

  const currentRule = igkLevelForLifetime(wallet?.lifetimeIgk ?? 0);
  const nextRule = IGK_LEVELS.find((rule) => rule.level > currentRule.level) ?? null;
  const previousThreshold = currentRule.minimumLifetimeIgk;
  const nextThreshold = nextRule?.minimumLifetimeIgk ?? previousThreshold;
  const segmentProgress = nextRule && wallet
    ? Math.min(100, Math.max(0, ((wallet.lifetimeIgk - previousThreshold) / (nextThreshold - previousThreshold)) * 100))
    : 100;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeading
        eyebrow="IGK grade roadmap"
        title="등급 로드맵"
        description="9등급에서 시작해 최종 등급 선생님까지 올라갑니다."
        actions={
          <Link href="/igk" className="inline-flex h-10 items-center gap-2 border border-slate-300 bg-white px-4 text-xs font-extrabold text-slate-700 hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" /> IGK 지갑
          </Link>
        }
      />

      {!wallet && !failed ? (
        <Card className="mt-6 grid min-h-48 place-items-center shadow-none">
          <div className="text-center text-sm font-bold text-slate-600">
            <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-emerald-700" />
            등급을 확인하는 중
          </div>
        </Card>
      ) : null}

      {failed ? (
        <Card className="mt-6 p-8 text-center shadow-none">
          <p className="text-sm font-bold text-slate-700">등급 정보를 불러오지 못했습니다.</p>
          <Button className="mt-4" onClick={() => window.location.reload()}>다시 시도</Button>
        </Card>
      ) : null}

      {wallet ? (
        <>
          <section className="mt-6 grid gap-px overflow-hidden border border-slate-200 bg-slate-200 md:grid-cols-[1.1fr_1fr_1fr]">
            <div className="bg-slate-950 p-6 text-white">
              <p className="text-xs font-bold text-emerald-400">현재 등급</p>
              <p className="mt-2 text-3xl font-black">{currentRule.label}</p>
            </div>
            <div className="bg-white p-6">
              <p className="text-xs font-bold text-slate-500">등급 누적 IGK</p>
              <p className="mt-2 text-2xl font-black text-slate-950">{wallet.lifetimeIgk.toLocaleString()}</p>
              <p className="mt-1 text-xs text-slate-500">활동 보상과 받은 선물</p>
            </div>
            <div className="bg-white p-6">
              <p className="text-xs font-bold text-slate-500">다음 목표</p>
              <p className="mt-2 text-2xl font-black text-slate-950">{nextRule?.label ?? '완료'}</p>
              <p className="mt-1 text-xs text-slate-500">
                {nextRule ? `${Math.max(0, nextRule.minimumLifetimeIgk - wallet.lifetimeIgk).toLocaleString()} IGK 남음` : '최종 등급 도달'}
              </p>
            </div>
          </section>

          <Card className="mt-5 p-5 shadow-none">
            <div className="flex items-center justify-between gap-4 text-xs font-bold text-slate-600">
              <span>{currentRule.label}</span>
              <span>{nextRule?.label ?? '선생님'}</span>
            </div>
            <div className="mt-3"><Progress value={segmentProgress} /></div>
          </Card>

          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {IGK_LEVELS.map((rule, index) => {
              const complete = wallet.level >= rule.level;
              const current = wallet.level === rule.level;
              const teacher = rule.label === '선생님';
              return (
                <article
                  key={rule.level}
                  className={`grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-4 border p-5 ${
                    current
                      ? 'border-emerald-400 bg-emerald-50'
                      : complete
                        ? 'border-slate-200 bg-white'
                        : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <span className={`grid h-11 w-11 place-items-center ${teacher ? 'bg-slate-950 text-white' : complete ? 'bg-emerald-700 text-white' : 'bg-white text-slate-400'}`}>
                    {teacher ? <GraduationCap className="h-5 w-5" /> : complete ? <Check className="h-5 w-5" /> : <span className="text-sm font-black">{index + 1}</span>}
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <strong className="text-base font-black text-slate-950">{rule.label}</strong>
                      {current ? <Badge tone="green">현재</Badge> : null}
                      {teacher ? <Trophy className="h-4 w-4 text-amber-600" /> : null}
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">누적 {rule.minimumLifetimeIgk.toLocaleString()} IGK부터</span>
                  </span>
                  <Coins className={`h-5 w-5 ${complete ? 'text-emerald-700' : 'text-slate-300'}`} />
                </article>
              );
            })}
          </div>

          <div className="mt-6 border-l-4 border-slate-900 bg-white p-5 text-sm leading-6 text-slate-700">
            받은 선물도 등급 누적에 포함됩니다. 다른 학생에게 IGK를 보내면 보유 잔액과 랭킹은 내려가지만, 이미 달성한 등급 누적은 줄지 않습니다.
          </div>
        </>
      ) : null}
    </div>
  );
}
