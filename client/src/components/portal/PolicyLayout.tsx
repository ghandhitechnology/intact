import { ReactNode } from 'react';

export default function PolicyLayout({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-4xl">
      <header className="border-b-2 border-[var(--ink)] bg-white px-6 py-8">
        <p className="section-kicker">{eyebrow}</p>
        <h1 className="mt-3 text-2xl font-black tracking-tight md:text-3xl">{title}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--ink-soft)]">{description}</p>
      </header>
      <article className="policy-content border-x border-b border-[var(--line-strong)] bg-white px-6 py-8 md:px-10">
        {children}
      </article>
    </div>
  );
}
