"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronRight,
  Clock3,
  FileText,
  Flame,
  Hash,
  Search,
  SlidersHorizontal,
  TrendingUp,
  X,
} from "lucide-react";
import { Avatar, BoardBadge, LevelBadge, PostMetrics, cx } from "./CommunityUI";
import {
  boards,
  members,
  posts,
  type BoardSlug,
  type Member,
  type PostSummary,
} from "./demo-data";
import { Card } from "@/components/operations/ui";
import { cosmeticsFromItems } from "@/lib/igk-shop";
import { fetchWithTimeout, isAbortError, requestErrorMessage } from "@/lib/client/request";

type SearchTab = "posts" | "members" | "tags";
type Sort = "relevance" | "latest" | "popular";

const DEMO_POPULAR_QUERIES = [
  "R&E 주제",
  "일반화학 정리",
  "Python 그래프",
  "축제 부스",
  "대회 팀원",
];
const DEMO_RECENT_QUERIES = ["오차 전파", "기숙사 타이머", "코드페어"];
const RECENT_SEARCHES_KEY = "igwak:recent-searches";
const MAX_RECENT_SEARCHES = 8;

const easeOut = "ease-[cubic-bezier(0.22,1,0.36,1)]";

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("ko");
}

function SearchPost({ post, query }: { post: PostSummary; query: string }) {
  return (
    <article className="px-5 py-5 transition-colors duration-150 hover:bg-slate-50/80 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <BoardBadge slug={post.board} />
        {post.hot && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-500">
            <Flame className="h-3 w-3" aria-hidden="true" />
            인기
          </span>
        )}
        <span className="ml-auto text-xs text-slate-400">
          {post.createdAt}
        </span>
      </div>
      <Link
        href={`/post/${post.id}`}
        className="group mt-3 block rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-slate-800 transition-colors group-hover:text-emerald-700">
          {post.title}
        </h2>
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">
          {post.excerpt}
        </p>
      </Link>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {post.tags.map((tag) => (
            <span
              key={tag}
              className={cx(
                "inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold",
                normalize(query) === normalize(tag)
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-slate-100 text-slate-500",
              )}
            >
              #{tag}
            </span>
          ))}
          <span className="ml-1 text-xs text-slate-400">
            {post.author.nickname} · {post.author.studentId}
          </span>
        </div>
        <PostMetrics post={post} />
      </div>
    </article>
  );
}

function SearchResultsSkeleton() {
  return (
    <div className="divide-y divide-slate-100" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="space-y-3 px-5 py-5 sm:px-6">
          <div className="skeleton h-4 w-20 rounded-full" />
          <div className="skeleton h-5 w-2/3" />
          <div className="skeleton h-3 w-full max-w-md" />
          <div className="flex gap-2">
            <div className="skeleton h-5 w-14 rounded-full" />
            <div className="skeleton h-5 w-14 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SearchClient({
  initialQuery = "",
}: {
  initialQuery?: string;
}) {
  const router = useRouter();
  const [input, setInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [tab, setTab] = useState<SearchTab>("posts");
  const [boardFilter, setBoardFilter] = useState<"all" | BoardSlug>("all");
  const [sort, setSort] = useState<Sort>("relevance");
  const [serverPosts, setServerPosts] = useState<PostSummary[]>([]);
  const [serverLoaded, setServerLoaded] = useState(false);
  const [serverMembers, setServerMembers] = useState<Member[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [recentQueries, setRecentQueries] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [stagger, setStagger] = useState(true);
  const demoMode = process.env.NEXT_PUBLIC_PORTAL_DEMO_MODE === "true";

  const normalizedQuery = normalize(query);

  useEffect(() => {
    try {
      const saved = JSON.parse(
        window.localStorage.getItem(RECENT_SEARCHES_KEY) || "[]",
      );
      const valid = Array.isArray(saved)
        ? saved
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, MAX_RECENT_SEARCHES)
        : [];
      const fallback =
        valid.length > 0 ? valid : demoMode ? DEMO_RECENT_QUERIES : [];
      const initial = initialQuery.trim();
      const next = initial
        ? [
            initial,
            ...fallback.filter(
              (item) => normalize(item) !== normalize(initial),
            ),
          ].slice(0, MAX_RECENT_SEARCHES)
        : fallback;
      setRecentQueries(next);
      if (initial)
        window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
    } catch {
      const initial = initialQuery.trim();
      setRecentQueries(
        initial ? [initial] : demoMode ? DEMO_RECENT_QUERIES : [],
      );
    }
  }, [demoMode, initialQuery]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const trimmedQuery = query.trim();
    const params = new URLSearchParams({ pageSize: "50" });
    if (!trimmedQuery && boardFilter !== "all")
      params.set("board", boardFilter);
    if (!trimmedQuery)
      params.set("sort", sort === "popular" ? "recommended" : "latest");
    const searchParams = new URLSearchParams({ q: trimmedQuery, sort });
    if (boardFilter !== "all") searchParams.set("board", boardFilter);
    const endpoint = trimmedQuery
      ? `/api/search?${searchParams.toString()}`
      : `/api/posts?${params.toString()}`;

    setIsSearching(true);
    setSearchError("");
    setServerLoaded(false);
    setMembersLoaded(false);
    if (!trimmedQuery) setServerMembers([]);

    fetchWithTimeout(endpoint, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error("search failed");
        return {
          posts: body?.data?.posts || body?.posts || [],
          users: trimmedQuery ? body?.data?.users || body?.users || [] : [],
        };
      })
      .then(({ posts: items, users }) => {
        if (!active || !Array.isArray(items)) return;
        const mappedPosts = items
          .filter(
            (item) =>
              item?.board?.slug &&
              boards.some((board) => board.slug === item.board.slug),
          )
          .map((item) => {
            const nickname =
              item?.author?.realName || item?.author?.nickname || "알 수 없음";
            return {
              id: item.id,
              board: item.board.slug as BoardSlug,
              title: item.title,
              excerpt: item.contentText || "",
              author: {
                id: item?.author?.id,
                nickname,
                studentId:
                  item?.author?.studentIdentity?.studentCode || "------",
                level: Number(item?.author?.level || 1),
                initials: nickname.slice(0, 1),
                profileImage: item?.author?.profileImage || null,
                standing: item?.author?.standing || null,
                igkRank: Number.isInteger(item?.author?.igkRank) ? Number(item.author.igkRank) : null,
                accent: "emerald" as const,
                cosmetics: cosmeticsFromItems(item?.author?.items),
              },
              createdAt: new Date(
                item.publishedAt || item.createdAt,
              ).toLocaleString("ko-KR"),
              sortAt: new Date(item.publishedAt || item.createdAt).getTime(),
              comments: Number(item.commentCount || 0),
              views: Number(item.viewCount || 0),
              likes: Number(item.recommendationCount || 0),
              tags: Array.isArray(item.tags) ? item.tags : [],
              hot: Number(item.recommendationCount || 0) >= 10,
              notice: Boolean(item.isPinned),
            } satisfies PostSummary;
          });
        const mappedMembers = Array.isArray(users)
          ? users.map((user) => {
              const nickname = user?.realName || user?.nickname || "알 수 없음";
              return {
                id: user?.id,
                nickname,
                studentId: user?.studentIdentity?.studentCode || "------",
                level: Number(user?.level || 1),
                initials: nickname.slice(0, 1),
                profileImage: user?.profileImage || null,
                standing: user?.standing || null,
                igkRank: Number.isInteger(user?.igkRank) ? Number(user.igkRank) : null,
                accent: "blue" as const,
              };
            })
          : [];
        setServerPosts(mappedPosts);
        setServerMembers(mappedMembers);
        setServerLoaded(true);
        setMembersLoaded(true);
      })
      .catch((error) => {
        if (!active || isAbortError(error)) return;
        setServerPosts([]);
        setServerMembers([]);
        setServerLoaded(!demoMode);
        setMembersLoaded(!demoMode);
        setSearchError(requestErrorMessage(error, "검색 결과를 불러오지 못했습니다."));
      })
      .finally(() => {
        if (active) setIsSearching(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [boardFilter, demoMode, query, reloadKey, sort]);

  const postResults = useMemo(() => {
    let result = (serverLoaded ? serverPosts : demoMode ? posts : []).filter(
      (post) => {
        if (boardFilter !== "all" && post.board !== boardFilter) return false;
        if (!normalizedQuery) return true;
        return normalize(
          `${post.title} ${post.excerpt} ${post.tags.join(" ")} ${post.author.nickname} ${post.author.studentId}`,
        ).includes(normalizedQuery);
      },
    );
    if (sort === "popular") {
      result = [...result].sort(
        (a, b) => b.likes + b.comments - (a.likes + a.comments),
      );
    } else if (sort === "latest" && normalizedQuery) {
      result = [...result].sort((a, b) => (b.sortAt || 0) - (a.sortAt || 0));
    }
    return result;
  }, [boardFilter, demoMode, normalizedQuery, serverLoaded, serverPosts, sort]);

  const memberResults = useMemo(
    () =>
      (membersLoaded ? serverMembers : demoMode ? members : []).filter(
        (member) => {
          if (!normalizedQuery) return true;
          return normalize(`${member.nickname} ${member.studentId}`).includes(
            normalizedQuery,
          );
        },
      ),
    [demoMode, membersLoaded, normalizedQuery, serverMembers],
  );

  const tagResults = useMemo(() => {
    const counts = new Map<string, number>();
    (serverLoaded ? serverPosts : demoMode ? posts : []).forEach((post) =>
      post.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)),
    );
    return Array.from(counts.entries())
      .filter(
        ([tag]) => !normalizedQuery || normalize(tag).includes(normalizedQuery),
      )
      .sort((a, b) => b[1] - a[1]);
  }, [demoMode, normalizedQuery, serverLoaded, serverPosts]);

  const countSource = serverLoaded ? serverPosts : demoMode ? posts : [];
  const suggestedQueries = demoMode
    ? DEMO_POPULAR_QUERIES
    : tagResults.slice(0, 5).map(([tag]) => tag);

  useEffect(() => {
    if (!stagger || postResults.length === 0) return undefined;
    const timer = window.setTimeout(() => setStagger(false), 900);
    return () => window.clearTimeout(timer);
  }, [stagger, postResults.length]);

  function rememberSearch(value: string) {
    setRecentQueries((current) => {
      const next = [
        value,
        ...current.filter((item) => normalize(item) !== normalize(value)),
      ].slice(0, MAX_RECENT_SEARCHES);
      try {
        window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
      } catch {
        // Device-local search history is an optional convenience.
      }
      return next;
    });
  }

  function searchFor(value: string) {
    const next = value.trim();
    setInput(next);
    setQuery(next);
    setTab("posts");
    if (next) rememberSearch(next);
    router.replace(next ? `/search?q=${encodeURIComponent(next)}` : "/search");
  }

  function clearRecentSearches() {
    setRecentQueries([]);
    try {
      window.localStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch {
      // Ignore unavailable browser storage.
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    searchFor(input);
  }

  const resultCounts: Record<SearchTab, number> = {
    posts: postResults.length,
    members: memberResults.length,
    tags: tagResults.length,
  };

  return (
    <div className="app-page px-4 py-3 sm:px-6 sm:py-5">
      <div className="mx-auto max-w-[1320px]">
        <Link
          href="/"
          className="mb-4 inline-flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-xs font-medium text-slate-500 transition-colors hover:text-emerald-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          홈으로
        </Link>

        <header className="anim-rise px-1 pb-5 pt-2">
          <h1 className="text-2xl font-bold tracking-[-0.03em] text-slate-950 sm:text-[28px]">
            인텍트 통합검색
          </h1>

          <form
            onSubmit={submit}
            className={cx(
              "mt-4 flex max-w-3xl items-center rounded-2xl border border-slate-200 bg-white shadow-[var(--shadow-xs)] transition-colors duration-150",
              easeOut,
              "focus-within:border-emerald-600 focus-within:ring-4 focus-within:ring-emerald-600/10",
            )}
          >
            <Search
              className="ml-4 h-5 w-5 shrink-0 self-center text-slate-400"
              aria-hidden="true"
            />
            <label htmlFor="community-search" className="sr-only">
              통합검색
            </label>
            <input
              id="community-search"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="게시글, 자료, 사용자 검색"
              className="h-12 min-w-0 flex-1 border-0 bg-transparent px-3 text-sm font-semibold text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus:ring-0"
            />
            {input && (
              <button
                type="button"
                onClick={() => setInput("")}
                className={cx(
                  "inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition-colors duration-150",
                  easeOut,
                  "hover:bg-slate-100 hover:text-slate-700",
                )}
                aria-label="검색어 지우기"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <button
              type="submit"
              className={cx(
                "m-1.5 inline-flex h-9 min-w-[68px] items-center justify-center rounded-xl bg-emerald-700 px-4 text-xs font-semibold text-white shadow-[var(--shadow-xs)] transition-colors duration-150",
                easeOut,
                "hover:bg-emerald-800",
              )}
            >
              검색
            </button>
          </form>
        </header>

        <div className="mt-1 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
          <Card className="anim-rise anim-delay-1 overflow-hidden">
            <div className="border-b border-slate-100 px-4 pb-3 pt-3 sm:px-6">
              <div
                className="ui-tabs flex gap-1 overflow-x-auto rounded-2xl bg-slate-100/80 p-1"
                role="tablist"
                aria-label="검색 결과 종류"
              >
                {(
                  [
                    ["posts", "게시글"],
                    ["members", "사용자"],
                    ["tags", "태그"],
                  ] as Array<[SearchTab, string]>
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={tab === value}
                    onClick={() => setTab(value)}
                    className={cx(
                      "flex h-9 shrink-0 snap-start items-center rounded-xl px-3.5 text-[13px] font-semibold transition-colors duration-150",
                      easeOut,
                                            tab === value
                        ? "bg-white text-slate-950 shadow-[var(--shadow-sm)]"
                        : "text-slate-500 hover:bg-white/60 hover:text-slate-900",
                    )}
                  >
                    {label}
                    <span className={cx(
                      "ml-2 min-w-[20px] rounded-full px-1.5 py-0.5 text-center text-xs tabular-nums",
                      tab === value ? "bg-emerald-50 text-emerald-800" : "bg-slate-200/70 text-slate-500",
                    )}>
                      {resultCounts[value]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {searchError ? (
              <div className="flex items-center justify-between gap-3 border-b border-amber-100 bg-amber-50/80 px-5 py-3 text-xs text-amber-900" role="alert">
                <span>{searchError}</span>
                <button type="button" onClick={() => setReloadKey((value) => value + 1)} className="shrink-0 rounded-md font-bold underline underline-offset-2 transition-colors hover:text-amber-950">다시 시도</button>
              </div>
            ) : null}

            {!searchError && tab === "posts" && (
              <>
                <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/50 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                  <p className="text-xs text-slate-500">
                    {query ? (
                      <>
                        <strong className="text-slate-800">‘{query}’</strong>{" "}
                        검색 결과{" "}
                        <strong className="text-emerald-700">
                          {postResults.length}개
                        </strong>
                        {isSearching && (
                          <span className="ml-2 text-slate-400">검색 중…</span>
                        )}
                      </>
                    ) : (
                      <>최근 게시글</>
                    )}
                  </p>
                  <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-500">
                    <SlidersHorizontal
                      className="h-3.5 w-3.5"
                      aria-hidden="true"
                    />
                    <span className="sr-only">정렬</span>
                    <select
                      value={sort}
                      onChange={(event) => setSort(event.target.value as Sort)}
                      className={cx(
                        "h-9 rounded-lg border border-slate-200 bg-white pl-3 pr-8 text-xs font-bold text-slate-600 transition-colors duration-150",
                        easeOut,
                        "hover:border-slate-300 focus:border-emerald-600 focus:outline-none focus:ring-4 focus:ring-emerald-600/10",
                      )}
                    >
                      <option value="relevance">관련도순</option>
                      <option value="latest">최신순</option>
                      <option value="popular">인기순</option>
                    </select>
                  </label>
                </div>
                <div className={cx("divide-y divide-slate-100", stagger && "stagger")}>
                  {postResults.length ? (
                    postResults.map((post) => (
                      <SearchPost key={post.id} post={post} query={query} />
                    ))
                  ) : isSearching ? (
                    <SearchResultsSkeleton />
                  ) : (
                    <div className="px-5 py-20 text-center">
                      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-300">
                        <Search className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <p className="mt-4 text-sm font-bold text-slate-700">
                        검색 결과가 없습니다.
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        단어를 줄이거나 다른 표현을 사용해 보세요.
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}

            {!searchError && tab === "members" && (
              <div className="grid gap-px bg-slate-100 sm:grid-cols-2">
                {memberResults.map((member) => (
                  <Link
                    key={`${member.nickname}:${member.studentId}`}
                    href={member.id ? `/users/${member.id}` : '#'}
                    className="group flex items-center gap-3 bg-white p-4 transition-colors duration-150 hover:bg-slate-50/80"
                  >
                    <Avatar member={member} size="lg" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-sm font-bold text-slate-800 transition-colors group-hover:text-emerald-700">
                          {member.nickname}
                        </h2>
                        <LevelBadge level={member.level} standing={member.standing} igkRank={member.igkRank} />
                      </div>
                      {member.studentId !== '------' ? (
                        <p className="mt-1 text-xs tabular-nums text-slate-400">
                          학번 {member.studentId}
                        </p>
                      ) : null}
                    </div>
                  </Link>
                ))}
                {!memberResults.length && (
                  <div className="col-span-2 bg-white px-5 py-20 text-center text-sm text-slate-400">
                    일치하는 사용자가 없습니다.
                  </div>
                )}
              </div>
            )}

            {!searchError && tab === "tags" && (
              <div className="grid gap-px bg-slate-100 sm:grid-cols-2 lg:grid-cols-3">
                {tagResults.map(([tag, count]) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => searchFor(tag)}
                    className="group flex items-center gap-3 bg-white p-4 text-left transition-colors duration-150 hover:bg-slate-50/80"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500 transition-colors group-hover:bg-emerald-50 group-hover:text-emerald-700">
                      <Hash className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-slate-700 transition-colors group-hover:text-emerald-800">
                        {tag}
                      </span>
                      <span className="mt-1 block text-xs text-slate-400">
                        게시글 {count}개
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <aside className="anim-rise anim-delay-2 grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            {suggestedQueries.length > 0 && (
              <Card className="p-4">
                <div className="mb-3 flex items-center gap-2">
                  <TrendingUp
                    className="h-4 w-4 text-rose-500"
                    aria-hidden="true"
                  />
                  <h2 className="text-sm font-bold text-slate-900">
                    {demoMode ? "인기 검색어" : "게시글 추천 태그"}
                  </h2>
                  <span className="ml-auto text-xs text-slate-400">
                    {demoMode ? "시연 데이터" : "현재 검색 기준"}
                  </span>
                </div>
                <ol className="divide-y divide-slate-100">
                  {suggestedQueries.map((item, index) => (
                    <li key={item}>
                      <button
                        type="button"
                        onClick={() => searchFor(item)}
                        className="group flex w-full items-center gap-3 rounded-lg px-1.5 py-2.5 text-left text-xs font-bold text-slate-600 transition-colors duration-150 hover:bg-slate-50/80 hover:text-emerald-700"
                      >
                        <span
                          className={cx(
                            "w-4 text-center font-bold tabular-nums",
                            index < 3 ? "text-emerald-700" : "text-slate-300",
                          )}
                        >
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{item}</span>
                        <ChevronRight
                          className="h-3.5 w-3.5 text-slate-300 transition-colors duration-150 group-hover:text-emerald-600"
                          aria-hidden="true"
                        />
                      </button>
                    </li>
                  ))}
                </ol>
              </Card>
            )}

            <Card className="p-4">
              <div className="mb-4 flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                <h2 className="text-sm font-bold text-slate-900">최근 검색</h2>
                {recentQueries.length > 0 && (
                  <button
                    type="button"
                    onClick={clearRecentSearches}
                    className="ml-auto rounded text-xs font-bold text-slate-400 transition-colors hover:text-slate-700"
                  >
                    전체 삭제
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {recentQueries.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => searchFor(item)}
                    className={cx(
                      "inline-flex h-7 items-center rounded-full border border-slate-200 bg-slate-50/60 px-2.5 text-xs font-semibold text-slate-500 transition-colors duration-150",
                      easeOut,
                      "hover:border-slate-300 hover:bg-white hover:text-slate-700",
                    )}
                  >
                    {item}
                  </button>
                ))}
                {recentQueries.length === 0 && (
                  <p className="text-xs leading-5 text-slate-400">
                    최근 검색 없음
                  </p>
                )}
              </div>
            </Card>

            <Card className="p-4 sm:col-span-2 xl:col-span-1">
              <div className="mb-3 flex items-center gap-2">
                <FileText
                  className="h-4 w-4 text-emerald-600"
                  aria-hidden="true"
                />
                <h2 className="text-sm font-bold text-slate-900">
                  게시판 좁혀보기
                </h2>
              </div>
              <div className="space-y-0.5">
                <button
                  type="button"
                  onClick={() => setBoardFilter("all")}
                  aria-pressed={boardFilter === "all"}
                  className={cx(
                    "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-bold transition-colors duration-200",
                    easeOut,
                    boardFilter === "all"
                      ? "bg-emerald-50 text-emerald-700"
                      : "text-slate-500 hover:bg-slate-50",
                  )}
                >
                  전체 게시판
                  <span className="tabular-nums">{countSource.length}</span>
                </button>
                {boards.map((board) => (
                  <button
                    key={board.slug}
                    type="button"
                    onClick={() => setBoardFilter(board.slug)}
                    aria-pressed={boardFilter === board.slug}
                    className={cx(
                      "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-bold transition-colors duration-200",
                      easeOut,
                      boardFilter === board.slug
                        ? "bg-emerald-50 text-emerald-700"
                        : "text-slate-500 hover:bg-slate-50",
                    )}
                  >
                    {board.title}
                    <span className="tabular-nums">
                      {
                        countSource.filter((post) => post.board === board.slug)
                          .length
                      }
                    </span>
                  </button>
                ))}
              </div>
            </Card>

          </aside>
        </div>
      </div>
    </div>
  );
}
