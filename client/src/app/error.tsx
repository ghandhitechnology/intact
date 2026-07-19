'use client';

import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useEffect } from 'react';

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
    <section className="surface-card mx-auto mt-16 max-w-lg px-7 py-12 text-center">
      <AlertTriangle className="mx-auto text-amber-600" size={34} />
      <h1 className="mt-5 text-xl font-bold">페이지를 여는 도중 문제가 생겼어요</h1>
      <button type="button" onClick={reset} className="primary-button mt-6">
        <RotateCcw size={16} /> 다시 시도
      </button>
      {error.digest && <p className="mt-5 font-mono text-xs text-[var(--ink-faint)]">참조 {error.digest}</p>}
    </section>
  );
}
