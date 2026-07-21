import { ArrowLeft, Compass } from 'lucide-react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="anim-rise mx-auto mt-16 max-w-lg rounded-2xl border border-slate-200/90 bg-white px-7 py-14 text-center shadow-[var(--shadow-sm)]">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-50 text-emerald-700 ring-8 ring-emerald-50/40">
        <Compass size={30} />
      </span>
      <p className="mt-6 text-xs font-bold tracking-[0.14em] text-emerald-700">404 · 길을 잃었어요</p>
      <h1 className="mt-3 text-[22px] font-bold tracking-[-0.03em] text-slate-950">이 페이지는 지금 찾을 수 없습니다.</h1>
      <p className="mt-3 text-sm leading-6 text-slate-500">글이 삭제되었거나 주소가 바뀌었을 수 있어요. 홈에서 다시 찾아보세요.</p>
      <Link
        href="/"
        className="mt-7 inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-emerald-800/60 bg-emerald-700 px-5 text-[13px] font-semibold text-white shadow-[var(--shadow-xs)] transition-colors duration-150 hover:bg-emerald-800 hover:shadow-[var(--shadow-sm)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-200"
      >
        <ArrowLeft size={16} />홈으로 돌아가기
      </Link>
    </section>
  );
}
