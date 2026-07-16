'use client';

import { AlertCircle, Bell, CalendarClock } from 'lucide-react';
import { useEffect, useState } from 'react';
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
    <div className="mx-auto max-w-5xl">
      <header className="border-b-2 border-slate-800 bg-white px-1 pb-4 pt-2">
        <h1 className="text-2xl font-bold tracking-[-0.03em] text-slate-950">운영 공지</h1>
        <p className="mt-2 text-sm text-slate-600">인텍트 이용에 필요한 변경 사항과 안내를 전합니다.</p>
      </header>
      <div className="bg-white">
        {loading && <div className="px-6 py-16 text-center text-sm font-bold text-slate-400">공지를 불러오는 중…</div>}
        {error && <div role="alert" className="m-6 flex items-center gap-2 border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700"><AlertCircle size={18} /><span className="min-w-0 flex-1">{error}</span><button type="button" onClick={() => setReloadKey((value) => value + 1)} className="shrink-0 underline underline-offset-2">다시 시도</button></div>}
        {!loading && !error && items.length === 0 && <div className="px-6 py-16 text-center"><Bell className="mx-auto text-slate-300" /><p className="mt-3 text-sm font-bold text-slate-500">공지 없음</p></div>}
        {items.map((notice) => (
          <article
            id={`notice-${notice.id}`}
            key={notice.id}
            tabIndex={-1}
            className="scroll-mt-36 border-b border-slate-200 px-4 py-4 outline-none last:border-b-0 target:bg-emerald-50/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600 sm:px-5"
          >
            <div className="flex flex-wrap items-center gap-2">
              {notice.priority >= 50 && <span className="bg-slate-950 px-2 py-1 text-xs font-bold text-white">필독</span>}
              <span className="inline-flex items-center gap-1 text-xs text-slate-400"><CalendarClock size={13} />{new Date(notice.publishedAt || notice.createdAt).toLocaleString('ko-KR')}</span>
              <span className="ml-auto text-xs font-bold text-slate-500">{notice.author?.nickname || '인텍트 운영팀'}</span>
            </div>
            <h2 className="mt-2 text-base font-bold tracking-tight text-slate-900">{notice.title}</h2>
            <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-600">{notice.content}</div>
          </article>
        ))}
      </div>
    </div>
  );
}
