export default function Loading() {
  return (
    <div className="grid gap-3" aria-label="페이지를 불러오는 중" aria-busy="true">
      <div className="skeleton h-8 w-36" />
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_280px]">
        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[var(--shadow-xs)]">
          <div className="grid gap-2.5">
            <div className="skeleton h-14 w-full" />
            <div className="skeleton h-14 w-full" />
            <div className="skeleton h-14 w-full" />
            <div className="skeleton h-14 w-full" />
          </div>
        </div>
        <div className="hidden rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[var(--shadow-xs)] md:block">
          <div className="skeleton h-4 w-24" />
          <div className="mt-4 grid gap-2.5">
            <div className="skeleton h-10 w-full" />
            <div className="skeleton h-10 w-full" />
          </div>
        </div>
      </div>
      <span className="sr-only">불러오는 중</span>
    </div>
  );
}
