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
  boardStyles,
  cx,
} from "./CommunityUI";
import {
  formatNumber,
  type BoardDefinition,
  type PostSummary,
} from "./demo-data";

type Filter = "all" | "popular" | "solved" | "files";
type Sort = "latest" | "likes" | "comments" | "views";

const sortLabels: Record<Sort, string> = {
  latest: "최신순",
  likes: "추천순",
  comments: "댓글순",
  views: "조회순",
};

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
      nickname,
      studentId: studentCode,
      level: Number(item?.author?.level || 1),
      initials: nickname.slice(0, 1),
      profileImage: item?.author?.profileImage || null,
      accent: "emerald",
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
    deadline:
      typeof metadata.deadline === "string" ? metadata.deadline : undefined,
  };
}

function PostRow({ post }: { post: PostSummary }) {
  return (
    <article className="border-b border-slate-100 px-4 py-[18px] transition-colors hover:bg-slate-50 sm:px-5">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_165px_154px] lg:items-center lg:gap-5">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {post.notice && (
              <span className="bg-slate-900 px-2 py-1 text-[10px] font-extrabold text-white">
                공지
              </span>
            )}
            {post.solved && <SolvedBadge />}
            {post.deadline && <DeadlineBadge deadline={post.deadline} />}
            {post.hot && (
              <span className="inline-flex items-center gap-1 bg-rose-50 px-2 py-1 text-[10px] font-extrabold text-rose-600">
                <Flame className="h-3 w-3" aria-hidden="true" />
                인기
              </span>
            )}
          </div>
          <Link
            href={`/post/${post.id}`}
            className="group inline-flex max-w-full items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <h2 className="line-clamp-2 text-[15px] font-extrabold leading-6 tracking-[-0.02em] text-slate-800 group-hover:text-emerald-700 sm:truncate">
              {post.title}
            </h2>
            {post.comments > 0 && (
              <span className="shrink-0 text-xs font-black text-emerald-600">
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
          <p className="mt-1.5 line-clamp-1 text-xs leading-5 text-slate-500">
            {post.excerpt}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500"
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 lg:block">
          <MemberLine member={post.author} compact />
          <p className="text-[11px] text-slate-400 lg:mt-1.5">
            {post.createdAt}
          </p>
        </div>

        <div className="flex items-center gap-4 text-[11px] tabular-nums text-slate-400 lg:justify-end">
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
  const style = boardStyles[board.accent];

  useEffect(() => {
    setPage(1);
  }, [board.slug, filter, query, sort, tag]);

  useEffect(() => {
    let active = true;
    setIsRefreshing(true);
    const params = new URLSearchParams({
      board: board.slug,
      page: String(page),
      pageSize: "20",
      sort: sort === "likes" ? "recommended" : sort,
      filter,
    });
    if (query.trim()) params.set("q", query.trim());
    if (tag) params.set("tag", tag);
    fetch(`/api/posts?${params.toString()}`, { cache: "no-store" })
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
      .catch(() => undefined)
      .finally(() => {
        if (active) setIsRefreshing(false);
      });
    return () => {
      active = false;
    };
  }, [board, filter, page, query, sort, tag]);

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
    <div className="min-h-screen px-0 py-2 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-[1440px]">
        <Link
          href="/"
          className="mb-5 inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-emerald-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          모든 게시판
        </Link>

        <header className="rounded-lg border border-stone-200 bg-white p-5 shadow-[0_3px_12px_rgba(51,56,50,0.03)] sm:p-6">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <BoardMark board={board} size="lg" />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-black tracking-[-0.04em] text-slate-950 sm:text-3xl">
                    {board.title}
                  </h1>
                  <span
                    className={cx(
                      "px-2 py-1 text-[10px] font-extrabold",
                      style.soft,
                    )}
                  >
                    오늘 +{board.todayCount}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {board.description}
                </p>
                <p className="mt-3 text-xs tabular-nums text-slate-400">
                  게시글 {formatNumber(board.postCount)}개
                </p>
              </div>
            </div>
            <Link
              href={`/boards/${board.slug}/write`}
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 border border-emerald-700 bg-emerald-700 px-5 text-sm font-extrabold text-white hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
            >
              <PenSquare className="h-4 w-4" aria-hidden="true" />
              글쓰기
            </Link>
          </div>
        </header>

        <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
          <section className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-[0_3px_12px_rgba(51,56,50,0.03)]">
            <div className="border-b border-slate-200 px-4 pt-4 sm:px-5 sm:pt-5">
              <div
                className="flex gap-1 overflow-x-auto"
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
                      "shrink-0 border-b-2 px-3 py-3 text-xs font-extrabold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
                      filter === item.value
                        ? "border-emerald-600 text-emerald-700"
                        : "border-transparent text-slate-400 hover:text-slate-700",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 border-b border-slate-200 bg-slate-50 p-4 sm:grid-cols-[minmax(0,1fr)_140px] sm:p-5">
              <label className="relative block">
                <span className="sr-only">게시판 안에서 검색</span>
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={`${board.shortTitle}에서 검색`}
                  className="h-10 w-full border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                />
              </label>
              <label className="relative block">
                <span className="sr-only">정렬 방식</span>
                <SlidersHorizontal
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as Sort)}
                  className="h-10 w-full appearance-none border border-slate-300 bg-white pl-9 pr-3 text-xs font-bold text-slate-700 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
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
              <div className="flex items-center gap-2 border-b border-slate-100 bg-emerald-50 px-5 py-3 text-xs text-emerald-800">
                <span className="font-bold">#{tag}</span> 태그만 보는 중
                <button
                  type="button"
                  onClick={() => setTag(null)}
                  className="ml-auto font-extrabold underline underline-offset-2"
                >
                  필터 해제
                </button>
              </div>
            )}

            <div>
              {filteredPosts.length > 0 ? (
                filteredPosts.map((post) => (
                  <PostRow key={post.id} post={post} />
                ))
              ) : (
                <div className="px-5 py-20 text-center">
                  <Search
                    className="mx-auto h-7 w-7 text-slate-300"
                    aria-hidden="true"
                  />
                  <p className="mt-3 text-sm font-extrabold text-slate-700">
                    조건에 맞는 글이 없어요.
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    검색어나 필터를 바꿔 보세요.
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <p className="text-[11px] text-slate-400">
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
                  className="inline-flex h-8 w-8 items-center justify-center border border-slate-200 text-slate-300 disabled:cursor-not-allowed"
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
                      "h-8 min-w-[32px] border px-2 text-xs font-bold",
                      pageNumber === page
                        ? "border-emerald-700 bg-emerald-700 text-white"
                        : "border-slate-200 bg-white text-slate-500 hover:border-slate-400",
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
                  className="inline-flex h-8 w-8 items-center justify-center border border-slate-200 text-slate-500 hover:border-slate-400"
                  aria-label="다음 페이지"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </nav>
            </div>
          </section>

          <aside className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <section className="rounded-lg border border-stone-200 bg-white p-5">
              <div className="mb-4 flex items-center gap-2">
                <FileText
                  className="h-4 w-4 text-blue-600"
                  aria-hidden="true"
                />
                <h2 className="text-sm font-black text-slate-900">인기 태그</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {board.tags.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setTag(tag === item ? null : item)}
                    aria-pressed={tag === item}
                    className={cx(
                      "border px-2.5 py-1.5 text-xs font-bold transition-colors",
                      tag === item
                        ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-white text-slate-500 hover:border-slate-400",
                    )}
                  >
                    #{item}
                  </button>
                ))}
              </div>
            </section>

            {weeklyPosts !== null && weeklyComments !== null && (
              <section className="rounded-lg border border-blue-200 bg-blue-50 p-5 sm:col-span-2 xl:col-span-1">
                <div className="flex items-start gap-3">
                  <BarChart3
                    className="mt-0.5 h-5 w-5 shrink-0 text-blue-700"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-black text-slate-900">
                      이번 주 활동
                    </h2>
                    <dl className="mt-4 grid grid-cols-2 gap-3">
                      <div>
                        <dt className="text-[10px] text-slate-500">
                          새 게시글
                        </dt>
                        <dd className="mt-1 text-lg font-black tabular-nums text-slate-900">
                          {weeklyPosts}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] text-slate-500">새 댓글</dt>
                        <dd className="mt-1 text-lg font-black tabular-nums text-slate-900">
                          {weeklyComments}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
