export default function RouteLoading({ compact = false }: { compact?: boolean }) {
  return (
    <div className="grid gap-3" aria-label="페이지를 불러오는 중" aria-busy="true">
      <div className={`${compact ? 'h-14' : 'h-20'} animate-pulse bg-white`} />
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_280px]">
        <div className={`${compact ? 'h-64' : 'h-[420px]'} animate-pulse bg-white`} />
        <div className="hidden h-64 animate-pulse bg-white md:block" />
      </div>
      <span className="sr-only">불러오는 중</span>
    </div>
  );
}
