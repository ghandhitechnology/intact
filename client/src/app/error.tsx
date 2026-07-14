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
      <h1 className="mt-5 text-xl font-black">페이지를 여는 도중 문제가 생겼어요</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">
        작성 중인 내용은 가능한 한 유지했습니다. 계속 문제가 있으면 문의·신고 메뉴로 알려 주세요.
      </p>
      <button type="button" onClick={reset} className="primary-button mt-6">
        <RotateCcw size={16} /> 다시 시도
      </button>
      {error.digest && <p className="mt-5 font-mono text-[10px] text-[var(--ink-faint)]">참조 {error.digest}</p>}
    </section>
  );
}
