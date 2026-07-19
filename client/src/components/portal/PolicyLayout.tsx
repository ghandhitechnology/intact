import { ReactNode } from 'react';

export default function PolicyLayout({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-5xl">
      <header className="border border-[var(--line-strong)] bg-white px-4 py-4 sm:px-5">
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-soft)]">{description}</p>
      </header>
      <article className="policy-content border-x border-b border-[var(--line-strong)] bg-white px-5 py-6 md:px-8">
        {children}
      </article>
    </div>
  );
}
