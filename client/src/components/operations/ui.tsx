'use client';

import { AlertCircle, CheckCircle2, ChevronRight, Loader2, X } from 'lucide-react';
import {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  useEffect,
  useId,
  useRef,
} from 'react';

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

export async function readApiEnvelope<T>(response: Response): Promise<ApiEnvelope<T> | null> {
  try {
    return await response.json() as ApiEnvelope<T>;
  } catch {
    return null;
  }
}

export function apiErrorMessage<T>(payload: ApiEnvelope<T> | null, fallback: string) {
  return payload && !payload.ok ? payload.error.message : fallback;
}

export function PageHeading({ title, description, actions }: {
  title: string; description?: string; actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-slate-300 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-[-0.025em] text-slate-950 sm:text-[28px]">{title}</h1>
        {description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{description}</p> : null}
      </div>
      {actions ? <div className="page-heading-actions w-full shrink-0 sm:w-auto">{actions}</div> : null}
    </div>
  );
}

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <section className={cn('border border-slate-300 bg-white', className)} {...props}>{children}</section>;
}

export function CardHeader({ title, description, action, className }: {
  title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string;
}) {
  return (
    <div className={cn('flex min-h-[52px] items-center justify-between gap-4 border-b border-slate-200 px-4 py-3', className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-bold tracking-[-0.01em] text-slate-950 sm:truncate">{title}</h2>
        {description ? <p className="mt-1 text-xs leading-5 text-slate-600">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

const buttonStyles = {
  primary: 'border border-emerald-700 bg-emerald-700 text-white hover:border-emerald-800 hover:bg-emerald-800 focus-visible:ring-emerald-200 disabled:border-slate-300 disabled:bg-slate-300',
  secondary: 'border border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50 focus-visible:ring-slate-200 disabled:text-slate-400',
  green: 'border border-emerald-700 bg-emerald-700 text-white hover:border-emerald-800 hover:bg-emerald-800 focus-visible:ring-emerald-200 disabled:border-slate-300 disabled:bg-slate-300',
  danger: 'border border-red-200 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100 focus-visible:ring-red-200 disabled:text-red-300',
  ghost: 'border border-transparent bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-950 focus-visible:ring-slate-200 disabled:text-slate-300',
};

export function Button({ variant = 'primary', className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonStyles }) {
  return <button className={cn('ui-button inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap px-3.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-4 disabled:cursor-not-allowed', buttonStyles[variant], className)} {...props}>{children}</button>;
}

export function IconButton({ label, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button aria-label={label} title={label} className={cn('ui-icon-button inline-flex h-10 w-10 items-center justify-center border border-transparent text-slate-500 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100', className)} {...props}>{children}</button>;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('ui-input h-10 w-full border border-slate-300 bg-white px-3 text-sm text-slate-950 placeholder:text-slate-400 transition focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-100 disabled:text-slate-500', className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn('ui-select h-10 w-full border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 transition focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100', className)} {...props}>{children}</select>;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('ui-textarea w-full resize-none border border-slate-300 bg-white px-3 py-2.5 text-sm leading-6 text-slate-950 placeholder:text-slate-400 transition focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100', className)} {...props} />;
}

export function Field({ label, hint, error, required, children }: {
  label: string; hint?: string; error?: string; required?: boolean; children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between gap-3 text-sm font-semibold text-slate-800">
        <span>{label}{required ? <span className="ml-1 text-emerald-700">*</span> : null}</span>
        {hint ? <span className="text-xs font-normal text-slate-500">{hint}</span> : null}
      </span>
      {children}
      {error ? <span className="mt-2 flex items-center gap-1.5 text-xs font-medium text-red-600"><AlertCircle className="h-3.5 w-3.5" />{error}</span> : null}
    </label>
  );
}

export function Badge({ tone = 'slate', children, className }: {
  tone?: 'slate' | 'blue' | 'green' | 'amber' | 'red' | 'violet'; children: ReactNode; className?: string;
}) {
  const tones = {
    slate: 'border-slate-300 bg-white text-slate-600', blue: 'border-blue-300 bg-white text-blue-700',
    green: 'border-emerald-300 bg-white text-emerald-700', amber: 'border-amber-300 bg-white text-amber-700',
    red: 'border-red-300 bg-white text-red-700', violet: 'border-violet-300 bg-white text-violet-700',
  };
  return <span className={cn('inline-flex min-h-[24px] items-center rounded-sm border px-2 text-xs font-semibold leading-5', tones[tone], className)}>{children}</span>;
}

export function Avatar({ name, imageUrl, size = 'md', status, tone = 'blue', className }: {
  name: string; imageUrl?: string | null; size?: 'sm' | 'md' | 'lg' | 'xl'; status?: 'online' | 'offline'; tone?: 'blue' | 'green' | 'violet' | 'amber' | 'slate'; className?: string;
}) {
  const sizes = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-12 w-12 text-base', xl: 'h-20 w-20 text-2xl' };
  const tones = { blue: 'bg-blue-100 text-blue-800', green: 'bg-emerald-100 text-emerald-800', violet: 'bg-violet-100 text-violet-800', amber: 'bg-amber-100 text-amber-800', slate: 'bg-slate-200 text-slate-700' };
  return (
    <span className="relative inline-flex shrink-0">
      <span className={cn('inline-flex items-center justify-center rounded-full border border-white bg-cover bg-center font-bold tracking-[-0.04em]', sizes[size], tones[tone], className)} style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}>{imageUrl ? <span className="sr-only">{name} 프로필 이미지</span> : name.slice(0, 2)}</span>
      {status ? <span className={cn('absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white', status === 'online' ? 'bg-emerald-500' : 'bg-slate-300')} /> : null}
    </span>
  );
}

export function Progress({ value, tone = 'blue' }: { value: number; tone?: 'blue' | 'green' }) {
  return <div className="h-2 overflow-hidden bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><div className={cn('h-full transition-all', tone === 'blue' ? 'bg-blue-600' : 'bg-emerald-600')} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

export function Tabs<T extends string>({ items, value, onChange, className }: {
  items: ReadonlyArray<{ value: T; label: string; count?: number }>; value: T; onChange: (value: T) => void; className?: string;
}) {
  return (
    <div className={cn('ui-tabs flex overflow-x-auto border-b border-slate-200 bg-white', className)} role="tablist">
      {items.map((item) => <button key={item.value} type="button" role="tab" aria-selected={value === item.value} onClick={() => onChange(item.value)} className={cn('relative flex h-11 shrink-0 snap-start items-center gap-2 px-4 text-[13px] font-semibold transition', value === item.value ? 'text-emerald-800 after:absolute after:bottom-0 after:left-3 after:right-3 after:h-0.5 after:bg-emerald-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')}>{item.label}{typeof item.count === 'number' ? <span className={cn('min-w-[20px] rounded-sm px-1.5 py-0.5 text-xs', value === item.value ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600')}>{item.count}</span> : null}</button>)}
    </div>
  );
}

export function Stat({ label, value, detail, icon, tone = 'blue' }: {
  label: string; value: string; detail?: string; icon?: ReactNode; tone?: 'blue' | 'green' | 'amber' | 'slate';
}) {
  const tones = { blue: 'text-blue-700', green: 'text-emerald-700', amber: 'text-amber-700', slate: 'text-slate-700' };
  return <div className="border-y border-slate-300 bg-white px-4 py-3.5"><div className="flex items-start justify-between gap-3"><p className="text-xs font-semibold text-slate-600">{label}</p>{icon ? <span className={cn('mt-0.5', tones[tone])}>{icon}</span> : null}</div><p className="mt-2 text-2xl font-bold tracking-[-0.035em] text-slate-950">{value}</p>{detail ? <p className="mt-1 text-xs leading-5 text-slate-600">{detail}</p> : null}</div>;
}

export function Modal({ open, title, description, children, footer, onClose, wide }: {
  open: boolean; title: string; description?: string; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      (first || dialogRef.current)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={cn('ui-modal max-h-[92dvh] w-full overflow-hidden border border-stone-300 bg-white', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="ui-modal-handle mx-auto mt-2 h-1 w-10 bg-slate-300 sm:hidden" aria-hidden="true" />
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6"><div><h2 id={titleId} className="text-lg font-bold tracking-[-0.02em] text-slate-950">{title}</h2>{description ? <p className="mt-1 text-sm leading-5 text-slate-500">{description}</p> : null}</div><IconButton label="닫기" onClick={onClose} className="-mr-2 -mt-1"><X className="h-5 w-5" /></IconButton></div>
        <div className="max-h-[65vh] overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer ? <div className="ui-modal-footer flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Toast({ message, tone = 'success', onClose }: { message: string | null; tone?: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => { if (!message) return undefined; const timer = window.setTimeout(onClose, 3200); return () => window.clearTimeout(timer); }, [message, onClose]);
  if (!message) return null;
  return <div role="status" className={cn('ui-toast fixed bottom-5 left-1/2 z-[120] flex min-w-[280px] -translate-x-1/2 items-center gap-3 border px-4 py-3 text-sm font-bold ', tone === 'success' ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-red-700 bg-red-700 text-white')}>{tone === 'success' ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}<span className="flex-1">{message}</span><button type="button" aria-label="알림 닫기" className="grid h-9 w-9 shrink-0 place-items-center" onClick={onClose}><X className="h-4 w-4" /></button></div>;
}

export function LoadingLabel({ children }: { children: ReactNode }) { return <><Loader2 className="h-4 w-4 animate-spin" />{children}</>; }

export function ListLink({ children, detail }: { children: ReactNode; detail?: ReactNode }) {
  return <div className="flex min-h-[52px] items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0"><div className="min-w-0 flex-1">{children}</div>{detail ?? <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}</div>;
}
