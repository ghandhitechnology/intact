export default function Loading() {
  return (
    <div className="grid gap-3" aria-label="페이지를 불러오는 중" aria-busy="true">
      <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[var(--shadow-xs)]">
        <div className="skeleton h-3.5 w-24" />
        <div className="mt-3 skeleton h-6 w-3/4" />
        <div className="mt-3 grid gap-2">
          <div className="skeleton h-3.5 w-full" />
          <div className="skeleton h-3.5 w-full" />
          <div className="skeleton h-3.5 w-1/2" />
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_280px]">
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[var(--shadow-xs)]">
          <div className="grid gap-3">
            <div className="skeleton h-16 w-full" />
            <div className="skeleton h-16 w-full" />
            <div className="skeleton h-16 w-full" />
            <div className="skeleton h-16 w-full" />
          </div>
        </div>
        <div className="hidden rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[var(--shadow-xs)] md:block">
          <div className="skeleton h-4 w-24" />
          <div className="mt-4 grid gap-3">
            <div className="skeleton h-10 w-full" />
            <div className="skeleton h-10 w-full" />
            <div className="skeleton h-10 w-full" />
          </div>
        </div>
      </div>
      <span className="sr-only">불러오는 중</span>
    </div>
  );
}
