import { WifiOff } from 'lucide-react';
import Link from 'next/link';

export const metadata = { title: '오프라인' };

export default function OfflinePage() {
  return (
    <section className="surface-card mx-auto mt-16 max-w-lg px-7 py-12 text-center">
      <WifiOff className="mx-auto text-[var(--ink-faint)]" size={34} />
      <h1 className="mt-5 text-xl font-bold tracking-tight">인터넷 연결을 확인해 주세요</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">
        인텍트는 학생 정보 보호를 위해 게시글을 기기에 저장하지 않습니다.
        연결이 복구되면 다시 시도해 주세요.
      </p>
      <Link href="/" className="primary-button mt-6">다시 시도</Link>
    </section>
  );
}
