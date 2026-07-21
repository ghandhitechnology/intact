'use client';

import { AlertCircle, Bell, CalendarClock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/operations/ui';
import { fetchWithTimeout, isAbortError, requestErrorMessage } from '@/lib/client/request';

type NoticeItem = {
  id: string;
  title: string;
  content: string;
  priority: number;
  publishedAt: string | null;
  createdAt: string;
  author?: { nickname?: string };
};

export default function NoticesPage() {
  const [items, setItems] = useState<NoticeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetchWithTimeout('/api/notices?limit=50', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.ok) throw new Error(body?.error?.message || '공지를 불러오지 못했습니다.');
        return body.data.notices as NoticeItem[];
      })
      .then((notices) => {
        if (active) setItems(notices);
      })
      .catch((cause) => {
        if (active && !isAbortError(cause)) setError(requestErrorMessage(cause, '공지를 불러오지 못했습니다.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadKey]);

  useEffect(() => {
    if (loading) return;
    let frame = 0;

    function scrollToCurrentNotice() {
      const rawHash = window.location.hash.slice(1);
      if (!rawHash) return;
      let targetId = rawHash;
      try {
        targetId = decodeURIComponent(rawHash);
      } catch {
        // Keep the raw fragment when it contains malformed percent encoding.
      }
      const target = document.getElementById(targetId);
      if (!target) return;
      frame = window.requestAnimationFrame(() => {
        target.scrollIntoView({ block: 'start' });
        target.focus({ preventScroll: true });
      });
    }

    scrollToCurrentNotice();
    window.addEventListener('hashchange', scrollToCurrentNotice);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('hashchange', scrollToCurrentNotice);
    };
  }, [items, loading]);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="anim-rise px-1 pb-5 pt-2">
        <h1 className="text-[26px] font-bold leading-tight tracking-[-0.03em] text-slate-950">운영 공지</h1>
      </header>
      <div className="anim-rise anim-delay-1 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[var(--shadow-xs)]">
        {loading && (
          <div className="grid gap-5 p-5 sm:p-6">
            {[0, 1, 2].map((row) => (
              <div key={row} className="grid gap-2.5">
                <div className="skeleton h-3.5 w-28" />
                <div className="skeleton h-5 w-2/3" />
                <div className="skeleton h-3.5 w-full" />
                <div className="skeleton h-3.5 w-4/5" />
              </div>
            ))}
            <p className="text-center text-sm font-medium text-slate-400">공지를 불러오는 중…</p>
          </div>
        )}
        {error && (
          <div role="alert" className="m-5 flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            <AlertCircle size={18} className="shrink-0" />
            <span className="min-w-0 flex-1">{error}</span>
            <button type="button" onClick={() => setReloadKey((value) => value + 1)} className="shrink-0 rounded-lg px-2 py-1 underline underline-offset-2 transition-colors hover:bg-red-100">다시 시도</button>
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <div className="px-6 py-16 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-slate-400"><Bell size={24} /></span>
            <p className="mt-4 text-sm font-semibold text-slate-500">공지 없음</p>
          </div>
        )}
        {items.map((notice) => (
          <article
            id={`notice-${notice.id}`}
            key={notice.id}
            tabIndex={-1}
            className="scroll-mt-36 border-b border-slate-100 px-5 py-5 outline-none transition-colors last:border-b-0 target:bg-emerald-50/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600 sm:px-6"
          >
            <div className="flex flex-wrap items-center gap-2">
              {notice.priority >= 50 && <Badge tone="red">필독</Badge>}
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-400"><CalendarClock size={13} />{new Date(notice.publishedAt || notice.createdAt).toLocaleString('ko-KR')}</span>
              <span className="ml-auto text-xs font-semibold text-slate-500">{notice.author?.nickname || '인텍트 운영팀'}</span>
            </div>
            <h2 className="mt-2.5 text-base font-bold tracking-[-0.015em] text-slate-950">{notice.title}</h2>
            <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-600">{notice.content}</div>
          </article>
        ))}
      </div>
    </div>
  );
}
