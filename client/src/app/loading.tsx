export default function Loading() {
  return (
    <div className="grid gap-4" aria-label="페이지를 불러오는 중" aria-busy="true">
      <div className="h-24 animate-pulse border border-[var(--line)] bg-white" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-72 animate-pulse border border-[var(--line)] bg-white" />
        <div className="h-72 animate-pulse border border-[var(--line)] bg-white" />
      </div>
      <span className="sr-only">불러오는 중</span>
    </div>
  );
}
