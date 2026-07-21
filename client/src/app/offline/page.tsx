import { WifiOff } from 'lucide-react';
import Link from 'next/link';

export const metadata = { title: '오프라인' };

export default function OfflinePage() {
  return (
    <section className="anim-rise mx-auto mt-16 max-w-lg rounded-2xl border border-slate-200/90 bg-white px-7 py-14 text-center shadow-[var(--shadow-sm)]">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-slate-100 text-slate-500 ring-8 ring-slate-100/50">
        <WifiOff size={30} />
      </span>
      <h1 className="mt-6 text-[22px] font-bold tracking-[-0.03em] text-slate-950">인터넷 연결을 확인해 주세요</h1>
      <p className="mt-3 text-sm leading-6 text-slate-500">
        인텍트는 학생 정보 보호를 위해 게시글을 기기에 저장하지 않습니다.
        연결이 복구되면 다시 시도해 주세요.
      </p>
      <Link
        href="/"
        className="mt-7 inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-emerald-800/60 bg-emerald-700 px-5 text-[13px] font-semibold text-white shadow-[var(--shadow-xs)] transition-colors duration-150 hover:bg-emerald-800 hover:shadow-[var(--shadow-sm)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-200"
      >
        다시 시도
      </Link>
    </section>
  );
}
