'use client';

import { Badge, Button, Card, PageHeading, Progress, readApiEnvelope } from '@/components/operations/ui';
import { IGK_LEVELS, igkLevelForLifetime, igkLevelLabel } from '@/lib/igk-levels';
import { ArrowLeft, Check, Coins, GraduationCap, Loader2, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

type Wallet = {
  currentIgk: number;
  lifetimeIgk: number;
  level: number;
  teacherRank?: number | null;
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
    <div className="mx-auto w-full max-w-[1200px] px-4 py-4 sm:px-6 lg:px-8">
      <PageHeading
        title="등급 로드맵"
        description="누적 IGK로 조진까지 올라가고, 조진 중 보유 IGK 상위 8명은 조졸 · N짱 호칭을 받습니다."
        actions={
          <Link href="/igk" className="inline-flex h-9 items-center gap-2 border border-slate-300 bg-white px-4 text-xs font-extrabold text-slate-700 hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" /> IGK 지갑
          </Link>
        }
      />

      {!wallet && !failed ? (
        <Card className="mt-4 grid min-h-40 place-items-center">
          <div className="text-center text-sm font-bold text-slate-600">
            <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-emerald-700" />
            등급을 확인하는 중
          </div>
        </Card>
      ) : null}

      {failed ? (
        <Card className="mt-4 p-8 text-center">
          <p className="text-sm font-bold text-slate-700">등급 정보를 불러오지 못했습니다.</p>
          <Button className="mt-4" onClick={() => window.location.reload()}>다시 시도</Button>
        </Card>
      ) : null}

      {wallet ? (
        <>
          <section className="mt-4 grid gap-px overflow-hidden border border-slate-200 bg-slate-200 md:grid-cols-[1.1fr_1fr_1fr]">
            <div className="bg-emerald-800 p-4 text-white">
              <p className="text-xs font-bold text-emerald-100">현재 등급</p>
              <p className="mt-2 text-2xl font-black">{igkLevelLabel(wallet.level, wallet.teacherRank)}</p>
            </div>
            <div className="bg-white p-4">
              <p className="text-xs font-bold text-slate-500">등급 누적 IGK</p>
              <p className="mt-2 text-xl font-black text-slate-950">{wallet.lifetimeIgk.toLocaleString()}</p>
              <p className="mt-1 text-xs text-slate-500">활동 보상과 받은 선물</p>
            </div>
            <div className="bg-white p-4">
              <p className="text-xs font-bold text-slate-500">다음 목표</p>
              <p className="mt-2 text-xl font-black text-slate-950">{nextRule?.label ?? (wallet.teacherRank ? `조졸 · ${wallet.teacherRank}짱` : '조진 랭킹')}</p>
              <p className="mt-1 text-xs text-slate-500">
                {nextRule ? `${Math.max(0, nextRule.minimumLifetimeIgk - wallet.lifetimeIgk).toLocaleString()} IGK 남음` : '최종 등급 도달'}
              </p>
            </div>
          </section>

          <Card className="mt-5 p-5 ">
            <div className="flex items-center justify-between gap-4 text-xs font-bold text-slate-600">
              <span>{igkLevelLabel(wallet.level, wallet.teacherRank)}</span>
              <span>{nextRule?.label ?? '조진'}</span>
            </div>
            <div className="mt-3"><Progress value={segmentProgress} /></div>
          </Card>

          {wallet.level >= 10 ? (
            <section className="mt-4 bg-blue-50 p-4">
              <p className="text-xs font-extrabold text-blue-800">조진 · 조졸 랭킹</p>
              <p className="mt-1 text-sm font-black text-slate-950">{igkLevelLabel(wallet.level, wallet.teacherRank)}</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">보유 IGK가 많은 조진부터 조졸 · 1짱–8짱을 표시하며, 9위부터는 조진으로 표시합니다.</p>
            </section>
          ) : null}

          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {IGK_LEVELS.map((rule, index) => {
              const complete = wallet.level >= rule.level;
              const current = wallet.level === rule.level;
              const teacher = rule.label === '조진';
              return (
                <article
                  key={rule.level}
                  className={`grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 border p-4 ${
                    current
                      ? 'border-emerald-400 bg-emerald-50'
                      : complete
                        ? 'border-slate-200 bg-white'
                        : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <span className={`grid h-10 w-10 place-items-center ${teacher ? 'bg-slate-950 text-white' : complete ? 'bg-emerald-700 text-white' : 'bg-white text-slate-400'}`}>
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

        </>
      ) : null}
    </div>
  );
}
