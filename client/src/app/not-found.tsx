import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="mx-auto mt-16 max-w-lg border-t-2 border-slate-800 bg-white px-2 py-10">
      <p className="text-sm font-semibold text-[var(--green-deep)]">404 · 길을 잃었어요</p>
      <h1 className="mt-3 text-2xl font-bold tracking-[-0.03em]">이 페이지는 지금 찾을 수 없습니다.</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">글이 삭제되었거나 주소가 바뀌었을 수 있어요. 홈에서 다시 찾아보세요.</p>
      <Link href="/" className="primary-button mt-6"><ArrowLeft size={16} />홈으로 돌아가기</Link>
    </section>
  );
}
