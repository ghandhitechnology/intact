'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const RECHECK_INTERVAL_MS = 30_000;

export default function MaintenancePage() {
  const [dots, setDots] = useState('');

  useEffect(() => {
    const ticker = setInterval(() => {
      setDots((current) => (current.length >= 3 ? '' : `${current}.`));
    }, 700);
    return () => clearInterval(ticker);
  }, []);

  useEffect(() => {
    let active = true;
    async function check() {
      try {
        const response = await fetch('/api/platform', { cache: 'no-store' });
        if (!response.ok) return;
        const payload = await response.json().catch(() => null);
        const enabled = Boolean(payload?.data?.maintenanceEnabled ?? payload?.maintenanceEnabled);
        if (active && !enabled) window.location.replace('/');
      } catch {
        // Still down; keep waiting.
      }
    }
    const timer = setInterval(() => void check(), RECHECK_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="grid min-h-screen place-items-center bg-[var(--surface-muted)] px-4 py-10">
      <main className="anim-rise w-full max-w-md">
        {/* A hastily taped-up paper notice */}
        <div className="relative -rotate-1 rounded-lg border border-slate-300/80 bg-[#fffdf3] p-7 shadow-[var(--shadow-lg)] transition-transform duration-200 hover:rotate-0 sm:p-9">
          <span
            aria-hidden="true"
            className="absolute -top-3 left-1/2 h-7 w-24 -translate-x-1/2 rotate-2 rounded-sm bg-amber-200/70 shadow-sm"
          />
          <span
            aria-hidden="true"
            className="absolute -bottom-2 right-6 h-5 w-14 rotate-6 rounded-sm bg-amber-200/60"
          />

          <svg
            viewBox="0 0 120 90"
            className="mx-auto h-24 w-32 text-slate-700"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {/* stick figure hunched over a server box */}
            <circle cx="42" cy="22" r="8" />
            <path d="M42 30v20M42 36l-12 8M42 36l13 4M42 50l-9 16M42 50l10 15" />
            {/* wrench in hand */}
            <path d="M55 40l10-6M65 34l3-5M65 34l5 2" />
            {/* server box with a sad face */}
            <rect x="76" y="42" width="30" height="34" rx="2" />
            <circle cx="85" cy="53" r="1.6" fill="currentColor" />
            <circle cx="97" cy="53" r="1.6" fill="currentColor" />
            <path d="M84 66c3-3 11-3 14 0" transform="rotate(180 91 64.5)" />
            {/* sweat drops */}
            <path d="M32 12c-1 2-1 3 0 4M110 34c-1 2-1 3 0 4" />
          </svg>

          <h1 className="mt-5 text-center text-2xl font-black leading-snug tracking-tight text-slate-900">
            서버 점검중입니다 bb
          </h1>

          <div className="mt-5 space-y-3 text-sm leading-6 text-slate-700">
            <p>
              안녕하세요, 인텍트 관리자입니다. 지금 서버를 열심히 고치는 중이에요 ㅠㅠ
              생각보다 손볼 곳이 많아서 잠깐 문을 닫았습니다.
            </p>
            <p>
              새로고침 몇 번 해봐도 소용없어요... 진짜예요. 점검이 끝나면 이 화면이
              알아서 사라지니까, 잠깐 스트레칭이라도 하고 와 주세요.
            </p>
            <p className="text-xs text-slate-500">
              작성한 글이나 IGK는 안전하게 보관 중이니 걱정하지 않으셔도 됩니다.
            </p>
          </div>

          <p className="mt-6 border-t border-dashed border-slate-300 pt-4 text-center text-xs font-bold text-slate-500">
            공사중{dots}
            <span className="sr-only">점검이 끝나면 자동으로 이동합니다.</span>
          </p>

          <p className="mt-3 text-right text-xs italic text-slate-400">— 급하게 씀, 관리자 드림</p>
        </div>

        <p className="mt-6 text-center text-[11px] text-slate-400">
          30초마다 자동으로 확인하고, 점검이 끝나면 바로 홈으로 데려다 드릴게요.
        </p>
        <p className="mt-3 text-center text-[11px] text-slate-400">
          <Link
            href="/admin"
            className="underline decoration-slate-300 underline-offset-2 transition-colors hover:text-slate-600"
          >
            (관리자)
          </Link>
        </p>
      </main>
    </div>
  );
}
