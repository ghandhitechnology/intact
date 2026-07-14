import { ArrowLeft, SearchX } from 'lucide-react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="surface-card mx-auto mt-16 max-w-lg px-7 py-12 text-center">
      <SearchX className="mx-auto text-[var(--ink-faint)]" size={35} />
      <p className="mt-5 text-xs font-black tracking-[0.16em] text-[var(--green-deep)]">404 NOT FOUND</p>
      <h1 className="mt-2 text-xl font-black">해당 페이지를 찾을 수 없어요</h1>
      <p className="mt-3 text-sm text-[var(--ink-soft)]">삭제되었거나 이동한 게시글일 수 있습니다.</p>
      <Link href="/" className="primary-button mt-6"><ArrowLeft size={16} />홈으로 돌아가기</Link>
    </section>
  );
}
