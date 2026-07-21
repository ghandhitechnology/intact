'use client';

import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/operations/ui';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') console.error(error);
  }, [error]);

  return (
    <section className="anim-rise mx-auto mt-16 max-w-lg rounded-2xl border border-slate-200/90 bg-white px-7 py-14 text-center shadow-[var(--shadow-sm)]">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-amber-50 text-amber-600 ring-8 ring-amber-50/40">
        <AlertTriangle size={30} />
      </span>
      <h1 className="mt-6 text-[22px] font-bold tracking-[-0.03em] text-slate-950">페이지를 여는 도중 문제가 생겼어요</h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">일시적인 오류일 수 있으니 잠시 후 다시 시도해 주세요.</p>
      <Button type="button" onClick={reset} className="mt-7">
        <RotateCcw size={16} /> 다시 시도
      </Button>
      {error.digest && <p className="mt-6 font-mono text-xs text-slate-400">참조 {error.digest}</p>}
    </section>
  );
}
