export default function Loading() {
  return (
    <div className="grid gap-4" aria-label="페이지를 불러오는 중" aria-busy="true">
      <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[var(--shadow-xs)]">
        <div className="skeleton h-5 w-40" />
        <div className="mt-3 grid gap-2">
          <div className="skeleton h-3.5 w-full" />
          <div className="skeleton h-3.5 w-2/3" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[var(--shadow-xs)]">
          <div className="skeleton h-4 w-28" />
          <div className="mt-4 grid gap-3">
            <div className="skeleton h-14 w-full" />
            <div className="skeleton h-14 w-full" />
            <div className="skeleton h-14 w-full" />
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[var(--shadow-xs)]">
          <div className="skeleton h-4 w-28" />
          <div className="mt-4 grid gap-3">
            <div className="skeleton h-14 w-full" />
            <div className="skeleton h-14 w-full" />
            <div className="skeleton h-14 w-full" />
          </div>
        </div>
      </div>
      <span className="sr-only">불러오는 중</span>
    </div>
  );
}
