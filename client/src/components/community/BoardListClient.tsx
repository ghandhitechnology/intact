"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  Flame,
  MessageCircle,
  Paperclip,
  PenSquare,
  Search,
  SlidersHorizontal,
  ThumbsUp,
} from "lucide-react";
import {
  BoardMark,
  DeadlineBadge,
  MemberLine,
  SolvedBadge,
  cx,
} from "./CommunityUI";
import {
  formatNumber,
  type BoardDefinition,
  type PostSummary,
} from "./demo-data";
import AttachmentGallery from "./AttachmentGallery";
import { Card } from "@/components/operations/ui";
import { cosmeticsFromItems } from "@/lib/igk-shop";
import { fetchWithTimeout, isAbortError, requestErrorMessage } from "@/lib/client/request";

type Filter = "all" | "popular" | "solved" | "files";
type Sort = "latest" | "likes" | "comments" | "views";

const sortLabels: Record<Sort, string> = {
  latest: "최신순",
  likes: "추천순",
  comments: "댓글순",
  views: "조회순",
};

const easeOut = "ease-[cubic-bezier(0.22,1,0.36,1)]";

const fieldClass = cx(
  "h-11 w-full rounded-xl border border-slate-200 bg-slate-50/60 text-sm text-slate-950",
  "placeholder:text-slate-400 transition-all duration-200",
  easeOut,
  "hover:border-slate-300 focus:border-emerald-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-600/10",
);

function mapApiPost(item: any, board: BoardDefinition): PostSummary {
  const studentCode = item?.author?.studentIdentity?.studentCode || "------";
  const nickname =
    item?.author?.realName || item?.author?.nickname || "알 수 없음";
  const metadata =
    item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  return {
    id: item.id,
    board: board.slug,
    title: item.title,
    excerpt: item.contentText || "",
    author: {
      id: item?.author?.id,
      nickname,
      studentId: studentCode,
      level: Number(item?.author?.level || 1),
      initials: nickname.slice(0, 1),
      profileImage: item?.author?.profileImage || null,
      standing: item?.author?.standing || null,
      igkRank: Number.isInteger(item?.author?.igkRank) ? Number(item.author.igkRank) : null,
      accent: "emerald",
      cosmetics: cosmeticsFromItems(item?.author?.items),
    },
    createdAt: new Date(item.publishedAt || item.createdAt).toLocaleString(
      "ko-KR",
      {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      },
    ),
    comments: Number(item.commentCount || 0),
    views: Number(item.viewCount || 0),
    likes: Number(item.recommendationCount || 0),
    tags: Array.isArray(item.tags) ? item.tags : [],
    hot: Number(item.recommendationCount || 0) >= 10,
    solved: Boolean(item.acceptedCommentId),
    notice: Boolean(item.isPinned),
    attachmentCount: Number(
      item?._count?.attachments || item.attachmentCount || 0,
    ),
    attachments: Array.isArray(item.attachments)
      ? item.attachments.map((attachment: any) => ({
          id: String(attachment.id),
          originalName: String(attachment.originalName || "사진"),
          mimeType: String(attachment.mimeType || "application/octet-stream"),
          sizeBytes: Number(attachment.sizeBytes || 0),
        }))
      : [],
    deadline:
      typeof metadata.deadline === "string" ? metadata.deadline : undefined,
  };
}

function PhotoPostCard({ post }: { post: PostSummary }) {
  return (
    <article className="px-3 py-4 transition-colors duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-slate-50/80 sm:px-4">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href={`/post/${post.id}`}
            className="line-clamp-2 text-base font-bold tracking-[-0.02em] text-slate-900 transition-colors hover:text-emerald-700"
          >
            {post.title}
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
            <MemberLine member={post.author} compact />
            <span>{post.createdAt}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs tabular-nums text-slate-400">
          <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" />{formatNumber(post.views)}</span>
          <span className="inline-flex items-center gap-1"><ThumbsUp className="h-3.5 w-3.5" />{formatNumber(post.likes)}</span>
          <span className="inline-flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" />{formatNumber(post.comments)}</span>
        </div>
      </div>
      {post.attachments?.length ? (
        <AttachmentGallery attachments={post.attachments} compact />
      ) : (
        <Link href={`/post/${post.id}`} className="grid h-40 place-items-center rounded-2xl bg-slate-100 text-xs font-bold text-slate-400 transition-colors hover:bg-slate-200/70">
          사진을 불러올 수 없어요.
        </Link>
      )}
    </article>
  );
}

function PostRow({ post }: { post: PostSummary }) {
  return (
    <article className="px-4 py-3.5 transition-colors duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-slate-50/80">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_165px_154px] lg:items-center lg:gap-5">
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {post.notice && (
              <span className="inline-flex h-5 items-center rounded-full bg-slate-900 px-2 text-[11px] font-semibold text-white">
                공지
              </span>
            )}
            {post.solved && <SolvedBadge />}
            {post.deadline && <DeadlineBadge deadline={post.deadline} />}
            {post.hot && (
              <span className="inline-flex h-5 items-center gap-1 rounded-full bg-rose-50 px-2 text-[11px] font-semibold text-rose-600">
                <Flame className="h-3 w-3" aria-hidden="true" />
                인기
              </span>
            )}
          </div>
          <Link
            href={`/post/${post.id}`}
            className="group inline-flex max-w-full items-center gap-2 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <h2 className="line-clamp-2 text-[15px] font-semibold leading-6 tracking-[-0.02em] text-slate-800 transition-colors group-hover:text-emerald-700 sm:truncate">
              {post.title}
            </h2>
            {post.comments > 0 && (
              <span className="shrink-0 text-xs font-bold tabular-nums text-emerald-600">
                {post.comments}
              </span>
            )}
            {!!post.attachmentCount && (
              <Paperclip
                className="h-3.5 w-3.5 shrink-0 text-slate-400"
                aria-label="첨부 파일 있음"
              />
            )}
          </Link>
          <p className="mt-1 line-clamp-1 text-xs leading-5 text-slate-500">
            {post.excerpt}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex h-5 items-center rounded-full bg-slate-100 px-2 text-[11px] font-semibold text-slate-500"
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 lg:block">
          <MemberLine member={post.author} compact />
          <p className="text-xs text-slate-400 lg:mt-1.5">
            {post.createdAt}
          </p>
        </div>

        <div className="flex items-center gap-4 text-xs tabular-nums text-slate-400 lg:justify-end">
          <span className="inline-flex items-center gap-1" title="조회수">
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            {formatNumber(post.views)}
          </span>
          <span className="inline-flex items-center gap-1" title="추천수">
            <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
            {formatNumber(post.likes)}
          </span>
          <span
            className="inline-flex items-center gap-1 lg:hidden"
            title="댓글수"
          >
            <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
            {formatNumber(post.comments)}
          </span>
        </div>
      </div>
    </article>
  );
}

function PostListSkeleton() {
  return (
    <div className="space-y-4 px-4 py-5" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="space-y-2.5">
          <div className="skeleton h-3 w-24" />
          <div className="skeleton h-5 w-3/4" />
          <div className="skeleton h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export default function BoardListClient({
  board,
  initialPosts,
}: {
  board: BoardDefinition;
  initialPosts: PostSummary[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("latest");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const demoMode = process.env.NEXT_PUBLIC_PORTAL_DEMO_MODE === "true";
  const [livePosts, setLivePosts] = useState(demoMode ? initialPosts : []);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    total: demoMode ? initialPosts.length : 0,
    pageCount: 1,
  });
  const [serverLoaded, setServerLoaded] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [stagger, setStagger] = useState(true);

  useEffect(() => {
    setPage(1);
  }, [board.slug, filter, query, sort, tag]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const params = new URLSearchParams({
      board: board.slug,
      page: String(page),
      pageSize: "20",
      sort: sort === "likes" ? "recommended" : sort,
      filter,
    });
    if (query.trim()) params.set("q", query.trim());
    if (tag) params.set("tag", tag);
    const timer = window.setTimeout(() => {
      setIsRefreshing(true);
      setLoadError("");
      fetchWithTimeout(`/api/posts?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error("load failed");
        return body?.data || body || {};
      })
      .then((data) => {
        const items = data.posts || [];
        if (active && Array.isArray(items)) {
          setLivePosts(items.map((item) => mapApiPost(item, board)));
          if (data.pagination) setPagination(data.pagination);
          setServerLoaded(true);
        }
      })
      .catch((error) => {
        if (active && !isAbortError(error)) {
          setLoadError(requestErrorMessage(error, "게시글을 불러오지 못했습니다."));
        }
      })
      .finally(() => {
        if (active) setIsRefreshing(false);
      });
    }, query.trim() ? 250 : 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [board, filter, page, query, reloadKey, sort, tag]);

  const filteredPosts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko");
    const result = livePosts.filter((post) => {
      if (filter === "popular" && !post.hot) return false;
      if (filter === "solved" && !post.solved) return false;
      if (filter === "files" && !post.attachmentCount) return false;
      if (tag && !post.tags.includes(tag)) return false;
      if (
        normalizedQuery &&
        !`${post.title} ${post.excerpt} ${post.author.nickname} ${post.tags.join(" ")}`
          .toLocaleLowerCase("ko")
          .includes(normalizedQuery)
      ) {
        return false;
      }
      return true;
    });

    if (sort === "latest") return result;
    return [...result].sort((a, b) => b[sort] - a[sort]);
  }, [filter, livePosts, query, sort, tag]);

  useEffect(() => {
    if (!stagger || filteredPosts.length === 0) return undefined;
    const timer = window.setTimeout(() => setStagger(false), 900);
    return () => window.clearTimeout(timer);
  }, [stagger, filteredPosts.length]);

  const filters: Array<{ value: Filter; label: string }> = [
    { value: "all", label: "전체" },
    { value: "popular", label: "인기" },
    ...(board.slug === "question"
      ? ([{ value: "solved", label: "해결된 질문" }] as Array<{
          value: Filter;
          label: string;
        }>)
      : []),
    { value: "files", label: "첨부 있음" },
  ];
  const pageButtons = useMemo(() => {
    const first = Math.max(1, Math.min(page - 2, pagination.pageCount - 4));
    const last = Math.min(pagination.pageCount, first + 4);
    return Array.from(
      { length: Math.max(0, last - first + 1) },
      (_, index) => first + index,
    );
  }, [page, pagination.pageCount]);
  const weeklyPosts =
    board.weeklyPostCount ?? (demoMode ? board.todayCount * 7 - 3 : null);
  const weeklyComments =
    board.weeklyCommentCount ?? (demoMode ? board.todayCount * 13 + 11 : null);

  return (
    <div className="app-page py-2 sm:py-4">
      <div className="mx-auto max-w-[1320px]">
        <Link
          href="/"
          className="mb-4 inline-flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-xs font-medium text-slate-500 transition-colors hover:text-emerald-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          모든 게시판
        </Link>

        <header className="anim-rise px-1 pb-5 pt-2">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex min-w-0 items-start gap-3.5">
              <BoardMark board={board} size="lg" />
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-2xl font-bold tracking-[-0.03em] text-slate-950 sm:text-[28px]">
                    {board.title}
                  </h1>
                  <span className="inline-flex h-6 items-center rounded-full bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-800">
                    오늘 +{board.todayCount}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {board.description}
                </p>
                <p className="mt-1 text-xs tabular-nums text-slate-400">
                  게시글 {formatNumber(board.postCount)}개
                </p>
              </div>
            </div>
            <Link
              href={`/boards/${board.slug}/write`}
              className={cx(
                "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-emerald-800/60 bg-emerald-700 px-4 text-[13px] font-semibold text-white",
                "shadow-[var(--shadow-xs)] transition-all duration-200",
                easeOut,
                "hover:-translate-y-px hover:bg-emerald-800 hover:shadow-[var(--shadow-sm)]",
                "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-200 active:scale-[0.97]",
              )}
            >
              <PenSquare className="h-4 w-4" aria-hidden="true" />
              글쓰기
            </Link>
          </div>
        </header>

        <div className="mt-1 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
          <Card className="anim-rise anim-delay-1 overflow-hidden">
            <div className="border-b border-slate-100 p-2 sm:px-3">
              <div
                className="ui-tabs flex gap-1 overflow-x-auto rounded-2xl bg-slate-100/80 p-1"
                role="group"
                aria-label="게시물 필터"
              >
                {filters.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setFilter(item.value)}
                    aria-pressed={filter === item.value}
                    className={cx(
                      "h-9 shrink-0 snap-start rounded-xl px-3.5 text-[13px] font-semibold transition-all duration-200",
                      easeOut,
                      "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-100 active:scale-[0.97]",
                      filter === item.value
                        ? "bg-white text-slate-950 shadow-[var(--shadow-sm)]"
                        : "text-slate-500 hover:bg-white/60 hover:text-slate-900",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2 border-b border-slate-100 p-3 sm:grid-cols-[minmax(0,1fr)_150px]">
              <label className="relative block">
                <span className="sr-only">게시판 안에서 검색</span>
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={`${board.shortTitle}에서 검색`}
                  className={cx(fieldClass, "pl-10 pr-3")}
                />
              </label>
              <label className="relative block">
                <span className="sr-only">정렬 방식</span>
                <SlidersHorizontal
                  className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as Sort)}
                  className={cx(fieldClass, "appearance-none pl-10 pr-3 font-semibold text-slate-700")}
                >
                  {(Object.keys(sortLabels) as Sort[]).map((item) => (
                    <option key={item} value={item}>
                      {sortLabels[item]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {tag && (
              <div className="anim-fade flex items-center gap-2 border-b border-slate-100 bg-emerald-50/70 px-5 py-3 text-xs text-emerald-800">
                <span className="font-bold">#{tag}</span> 태그만 보는 중
                <button
                  type="button"
                  onClick={() => setTag(null)}
                  className="ml-auto rounded-md font-semibold underline underline-offset-2 transition-colors hover:text-emerald-900"
                >
                  필터 해제
                </button>
              </div>
            )}

            {loadError ? (
              <div className="flex items-center justify-between gap-3 border-b border-amber-100 bg-amber-50/80 px-5 py-3 text-xs text-amber-900" role="alert">
                <span>{loadError}</span>
                <button type="button" onClick={() => setReloadKey((value) => value + 1)} className="shrink-0 rounded-md font-bold underline underline-offset-2 transition-colors hover:text-amber-950">다시 시도</button>
              </div>
            ) : null}

            <div className={cx("divide-y divide-slate-100", stagger && "stagger")}>
              {filteredPosts.length > 0 ? (
                filteredPosts.map((post) =>
                  board.slug === "photos" ? (
                    <PhotoPostCard key={post.id} post={post} />
                  ) : (
                    <PostRow key={post.id} post={post} />
                  ),
                )
              ) : isRefreshing && !loadError ? (
                <PostListSkeleton />
              ) : (
                <div className="px-5 py-20 text-center">
                  <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-300">
                    <Search className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <p className="mt-3 text-sm font-semibold text-slate-700">
                    {loadError ? "게시글을 표시할 수 없어요." : "조건에 맞는 글이 없어요."}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {loadError ? "다시 시도해 주세요." : "검색어나 필터를 바꿔 보세요."}
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-100 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-400">
                {isRefreshing
                  ? "최신 게시글을 확인하는 중…"
                  : `${serverLoaded ? `전체 ${pagination.total}개 중` : "미리보기"} ${filteredPosts.length}개 표시`}
              </p>
              <nav
                className="flex items-center gap-1"
                aria-label="게시글 페이지"
              >
                <button
                  type="button"
                  disabled={page <= 1 || isRefreshing}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  className={cx(
                    "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-all duration-200",
                    easeOut,
                    "hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97] disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:border-slate-200 disabled:hover:bg-transparent",
                  )}
                  aria-label="이전 페이지"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                {pageButtons.map((pageNumber) => (
                  <button
                    key={pageNumber}
                    type="button"
                    onClick={() => setPage(pageNumber)}
                    disabled={isRefreshing}
                    aria-current={pageNumber === page ? "page" : undefined}
                    className={cx(
                      "h-9 min-w-[36px] rounded-lg border px-2 text-xs font-bold tabular-nums transition-all duration-200",
                      easeOut,
                      "active:scale-[0.97]",
                      pageNumber === page
                        ? "border-emerald-700 bg-emerald-700 text-white shadow-[var(--shadow-xs)]"
                        : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50",
                    )}
                  >
                    {pageNumber}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={page >= pagination.pageCount || isRefreshing}
                  onClick={() =>
                    setPage((value) =>
                      Math.min(pagination.pageCount, value + 1),
                    )
                  }
                  className={cx(
                    "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-all duration-200",
                    easeOut,
                    "hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97] disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:border-slate-200 disabled:hover:bg-transparent",
                  )}
                  aria-label="다음 페이지"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </nav>
            </div>
          </Card>

          <aside className="anim-rise anim-delay-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <Card className="p-4">
              <div className="mb-4 flex items-center gap-2">
                <FileText
                  className="h-4 w-4 text-emerald-600"
                  aria-hidden="true"
                />
                <h2 className="text-sm font-bold text-slate-900">인기 태그</h2>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {board.tags.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setTag(tag === item ? null : item)}
                    aria-pressed={tag === item}
                    className={cx(
                      "inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-semibold transition-all duration-200",
                      easeOut,
                      "active:scale-[0.97]",
                      tag === item
                        ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700",
                    )}
                  >
                    #{item}
                  </button>
                ))}
              </div>
            </Card>

            {weeklyPosts !== null && weeklyComments !== null && (
              <Card className="p-4 sm:col-span-2 xl:col-span-1">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                    <BarChart3 className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-bold text-slate-900">
                      이번 주 활동
                    </h2>
                    <dl className="mt-3 grid grid-cols-2 gap-3">
                      <div className="rounded-xl bg-slate-50/80 px-3 py-2.5">
                        <dt className="text-xs text-slate-500">
                          새 게시글
                        </dt>
                        <dd className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                          {weeklyPosts}
                        </dd>
                      </div>
                      <div className="rounded-xl bg-slate-50/80 px-3 py-2.5">
                        <dt className="text-xs text-slate-500">새 댓글</dt>
                        <dd className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                          {weeklyComments}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </Card>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
