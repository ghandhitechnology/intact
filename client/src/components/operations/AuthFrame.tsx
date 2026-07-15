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
      <header className="border-b border-[var(--line)] bg-white">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-5 sm:h-16 sm:px-8">
          <Link href="/main" className="text-[17px] font-extrabold tracking-[-0.045em] text-[var(--ink)] sm:text-lg">
            인텍트
          </Link>
          <span className="text-xs font-medium text-[var(--ink-soft)]">
            {mode === 'login' ? '학생 계정' : '재학생 확인'}
          </span>
        </div>
      </header>

      <main id="main-content" className="flex flex-1 px-5 py-8 sm:px-8 sm:py-12">
        <section className="mx-auto w-full max-w-[420px] self-start">
          <div className="mb-7">
            <h1 className="text-[28px] font-bold leading-tight tracking-[-0.045em] text-[var(--ink)] sm:text-[32px]">
              {title}
            </h1>
            {description ? <p className="mt-4 max-w-sm text-[15px] leading-6 text-[var(--ink-soft)]">{description}</p> : null}
          </div>
          {children}
        </section>
      </main>

      <footer className="px-5 pb-7 sm:px-8">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 border-t border-[var(--line-strong)] pt-5 text-[11px] text-[var(--ink-faint)]">
          <span>문의 tataboxprotein@gmail.com</span>
        </div>
      </footer>
    </div>
  );
}
