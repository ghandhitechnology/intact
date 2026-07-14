import type { ReactNode } from 'react';

function safeHref(value: string) {
  const href = value.trim();
  if (href.startsWith('/') && !href.startsWith('//') && !href.includes('\\')) return href;
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function inlineMarkdown(value: string): ReactNode[] {
  const pattern = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\([^\s)]+\))/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    if (match.index > cursor) nodes.push(value.slice(cursor, match.index));
    const token = match[0];
    const key = `${match.index}-${token}`;
    if (token.startsWith('**')) {
      nodes.push(<strong key={key} className="font-extrabold text-slate-900">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith('`')) {
      nodes.push(<code key={key} className="border border-slate-200 bg-slate-50 px-1 py-0.5 font-mono text-[0.92em] text-blue-800">{token.slice(1, -1)}</code>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = link ? safeHref(link[2] || '') : null;
      nodes.push(href ? (
        <a
          key={key}
          href={href}
          target={href.startsWith('/') ? undefined : '_blank'}
          rel={href.startsWith('/') ? undefined : 'noopener noreferrer'}
          className="font-bold text-blue-700 underline decoration-blue-200 underline-offset-2 hover:decoration-blue-700"
        >
          {link?.[1]}
        </a>
      ) : token);
    }
    cursor = match.index + token.length;
  }
  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

export default function SafeMarkdown({ content, compact = false }: { content: string; compact?: boolean }) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index] || '';
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.startsWith('- ')) {
      const items: string[] = [];
      while (index < lines.length && (lines[index] || '').startsWith('- ')) {
        items.push((lines[index] || '').slice(2));
        index += 1;
      }
      blocks.push(
        <ul key={`list-${index}`} className="list-disc space-y-1 pl-5">
          {items.map((item, itemIndex) => <li key={`${itemIndex}-${item}`}>{inlineMarkdown(item)}</li>)}
        </ul>,
      );
      continue;
    }
    if (line.startsWith('> ')) {
      blocks.push(
        <blockquote key={`quote-${index}`} className="border-l-4 border-emerald-500 bg-emerald-50 px-4 py-2 text-slate-600">
          {inlineMarkdown(line.slice(2))}
        </blockquote>,
      );
      index += 1;
      continue;
    }
    blocks.push(<p key={`paragraph-${index}`}>{inlineMarkdown(line)}</p>);
    index += 1;
  }

  return (
    <div className={compact ? 'space-y-2 text-sm leading-7 text-slate-700' : 'space-y-4 break-words text-[15px] leading-8 text-slate-700'}>
      {blocks}
    </div>
  );
}
