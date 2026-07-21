import Link from 'next/link';
import { ReactNode } from 'react';

export default function AuthFrame({
  mode,
  title,
  description,
  children,
}: {
  mode: 'login' | 'register';
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-[var(--surface-muted)] text-[var(--ink)]">
      <main
        id="main-content"
        className="flex flex-1 flex-col items-center justify-center px-5 pb-14 pt-[calc(40px+env(safe-area-inset-top))] sm:pt-[calc(56px+env(safe-area-inset-top))]"
      >
        <Link
          href="/"
          className="anim-fade group flex flex-col items-center gap-2 rounded-xl px-3 py-1"
        >
          <span className="text-[24px] font-extrabold leading-none tracking-[-0.05em] text-[var(--ink)] transition-colors group-hover:text-[var(--green)]">
            인텍트
          </span>
          <span className="text-[11px] font-medium tracking-[0.14em] text-[var(--ink-faint)]">
            인천과학고 생활 포털
          </span>
        </Link>

        <section className="anim-rise anim-delay-1 mt-8 w-full max-w-[440px] rounded-3xl border border-[var(--line)] bg-[var(--surface)] px-6 py-8 shadow-[var(--shadow-sm)] sm:px-9 sm:py-10">
          <p className="text-[11px] font-bold tracking-[0.16em] text-[var(--green)]">
            {mode === 'login' ? '재학생 로그인' : '재학생 확인 후 가입'}
          </p>
          <h1 className="mt-2.5 text-[24px] font-bold leading-snug tracking-[-0.03em] text-[var(--ink)]">
            {title}
          </h1>
          {description ? (
            <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{description}</p>
          ) : null}
          <div className="mt-7">{children}</div>
        </section>

        <footer className="anim-fade anim-delay-2 mt-7 pb-[env(safe-area-inset-bottom)] text-xs text-[var(--ink-faint)]">
          문의 tataboxprotein@gmail.com
        </footer>
      </main>
    </div>
  );
}
