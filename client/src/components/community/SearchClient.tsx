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

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("ko");
}

function SearchPost({ post, query }: { post: PostSummary; query: string }) {
  return (
    <article className="border-b border-slate-100 px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <BoardBadge slug={post.board} />
        {post.hot && (
          <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-rose-500">
            <Flame className="h-3 w-3" aria-hidden="true" />
            인기
          </span>
        )}
        <span className="ml-auto text-[10px] text-slate-400">
          {post.createdAt}
        </span>
      </div>
      <Link
        href={`/post/${post.id}`}
        className="group mt-3 block focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        <h2 className="text-[15px] font-extrabold tracking-[-0.02em] text-slate-800 group-hover:text-emerald-700">
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
                "px-2 py-1 text-[10px] font-bold",
                normalize(query) === normalize(tag)
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-slate-100 text-slate-500",
              )}
            >
              #{tag}
            </span>
          ))}
          <span className="ml-1 text-[10px] text-slate-400">
            {post.author.nickname} · {post.author.studentId}
          </span>
        </div>
        <PostMetrics post={post} />
      </div>
    </article>
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
    const endpoint = trimmedQuery
      ? `/api/search?q=${encodeURIComponent(trimmedQuery)}`
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
                nickname,
                studentId:
                  item?.author?.studentIdentity?.studentCode || "------",
                level: Number(item?.author?.level || 1),
                initials: nickname.slice(0, 1),
                profileImage: item?.author?.profileImage || null,
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
                nickname,
                studentId: user?.studentIdentity?.studentCode || "------",
                level: Number(user?.level || 1),
                initials: nickname.slice(0, 1),
                profileImage: user?.profileImage || null,
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
    <div className="min-h-screen px-4 py-2 sm:px-6 sm:py-4 lg:px-8">
      <div className="mx-auto max-w-[1540px]">
        <Link
          href="/"
          className="mb-3 inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-500 hover:text-emerald-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          홈으로
        </Link>

        <header className="border border-slate-200 bg-white px-4 py-4 sm:px-5">
          <h1 className="text-xl font-black tracking-[-0.035em] text-slate-950 sm:text-2xl">
            인텍트 통합검색
          </h1>

          <form
            onSubmit={submit}
            className="mt-4 flex max-w-3xl border border-slate-400 bg-white focus-within:border-emerald-700 focus-within:ring-1 focus-within:ring-emerald-700"
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
              className="h-10 min-w-0 flex-1 border-0 px-3 text-sm font-semibold text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:ring-0"
            />
            {input && (
              <button
                type="button"
                onClick={() => setInput("")}
                className="inline-flex h-10 w-10 items-center justify-center text-slate-400 hover:text-slate-700"
                aria-label="검색어 지우기"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <button
              type="submit"
              className="m-1 inline-flex min-w-[68px] items-center justify-center bg-emerald-700 px-4 text-xs font-extrabold text-white hover:bg-emerald-800"
            >
              검색
            </button>
          </form>
        </header>

        <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
          <section className="border border-slate-200 bg-white ">
            <div className="border-b border-slate-200 px-4 pt-4 sm:px-6 sm:pt-5">
              <div
                className="flex gap-1 overflow-x-auto"
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
                      "shrink-0 border-b-2 px-4 py-3 text-xs font-extrabold",
                      tab === value
                        ? "border-emerald-600 text-emerald-700"
                        : "border-transparent text-slate-400 hover:text-slate-700",
                    )}
                  >
                    {label}
                    <span className="ml-1.5 tabular-nums">
                      {resultCounts[value]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {searchError ? (
              <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-5 py-3 text-xs text-amber-950" role="alert">
                <span>{searchError}</span>
                <button type="button" onClick={() => setReloadKey((value) => value + 1)} className="shrink-0 font-bold underline underline-offset-2">다시 시도</button>
              </div>
            ) : null}

            {!searchError && tab === "posts" && (
              <>
                <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
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
                  <label className="inline-flex items-center gap-2 text-[11px] font-bold text-slate-500">
                    <SlidersHorizontal
                      className="h-3.5 w-3.5"
                      aria-hidden="true"
                    />
                    <span className="sr-only">정렬</span>
                    <select
                      value={sort}
                      onChange={(event) => setSort(event.target.value as Sort)}
                      className="border-0 bg-transparent pr-7 text-[11px] font-bold text-slate-600 focus:ring-0"
                    >
                      <option value="relevance">관련도순</option>
                      <option value="latest">최신순</option>
                      <option value="popular">인기순</option>
                    </select>
                  </label>
                </div>
                <div>
                  {postResults.length ? (
                    postResults.map((post) => (
                      <SearchPost key={post.id} post={post} query={query} />
                    ))
                  ) : (
                    <div className="px-5 py-20 text-center">
                      <Search
                        className="mx-auto h-8 w-8 text-slate-300"
                        aria-hidden="true"
                      />
                      <p className="mt-4 text-sm font-black text-slate-700">
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
                  <article
                    key={member.studentId}
                    className="flex items-center gap-3 bg-white p-4"
                  >
                    <Avatar member={member} size="lg" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-sm font-black text-slate-800">
                          {member.nickname}
                        </h2>
                        <LevelBadge level={member.level} />
                      </div>
                      {member.studentId !== '------' ? (
                        <p className="mt-1 text-[11px] tabular-nums text-slate-400">
                          학번 {member.studentId}
                        </p>
                      ) : null}
                    </div>
                  </article>
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
                    className="group flex items-center gap-3 bg-white p-4 text-left hover:bg-emerald-50"
                  >
                    <span className="inline-flex h-9 w-9 items-center justify-center border border-slate-200 bg-slate-50 text-slate-500 group-hover:border-emerald-200 group-hover:bg-white group-hover:text-emerald-700">
                      <Hash className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block text-sm font-extrabold text-slate-700 group-hover:text-emerald-800">
                        {tag}
                      </span>
                      <span className="mt-1 block text-[10px] text-slate-400">
                        게시글 {count}개
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <aside className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            {suggestedQueries.length > 0 && (
              <section className="border border-slate-200 bg-white p-4">
                <div className="mb-4 flex items-center gap-2">
                  <TrendingUp
                    className="h-4 w-4 text-rose-500"
                    aria-hidden="true"
                  />
                  <h2 className="text-sm font-black text-slate-900">
                    {demoMode ? "인기 검색어" : "게시글 추천 태그"}
                  </h2>
                  <span className="ml-auto text-[10px] text-slate-400">
                    {demoMode ? "시연 데이터" : "현재 검색 기준"}
                  </span>
                </div>
                <ol className="border-t border-slate-900">
                  {suggestedQueries.map((item, index) => (
                    <li key={item} className="border-b border-slate-100">
                      <button
                        type="button"
                        onClick={() => searchFor(item)}
                        className="flex w-full items-center gap-3 py-3 text-left text-xs font-bold text-slate-600 hover:text-emerald-700"
                      >
                        <span
                          className={cx(
                            "w-4 text-center font-black tabular-nums",
                            index < 3 ? "text-emerald-700" : "text-slate-300",
                          )}
                        >
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{item}</span>
                        <ChevronRight
                          className="h-3.5 w-3.5 text-slate-300"
                          aria-hidden="true"
                        />
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <section className="border border-slate-200 bg-white p-4">
              <div className="mb-4 flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-blue-600" aria-hidden="true" />
                <h2 className="text-sm font-black text-slate-900">최근 검색</h2>
                {recentQueries.length > 0 && (
                  <button
                    type="button"
                    onClick={clearRecentSearches}
                    className="ml-auto text-[10px] font-bold text-slate-400 hover:text-slate-700"
                  >
                    전체 삭제
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {recentQueries.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => searchFor(item)}
                    className="border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-bold text-slate-500 hover:border-slate-400"
                  >
                    {item}
                  </button>
                ))}
                {recentQueries.length === 0 && (
                  <p className="text-[11px] leading-5 text-slate-400">
                    최근 검색 없음
                  </p>
                )}
              </div>
            </section>

            <section className="border border-slate-200 bg-white p-4 sm:col-span-2 xl:col-span-1">
              <div className="mb-4 flex items-center gap-2">
                <FileText
                  className="h-4 w-4 text-emerald-600"
                  aria-hidden="true"
                />
                <h2 className="text-sm font-black text-slate-900">
                  게시판 좁혀보기
                </h2>
              </div>
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => setBoardFilter("all")}
                  aria-pressed={boardFilter === "all"}
                  className={cx(
                    "flex w-full items-center justify-between px-2 py-2 text-left text-xs font-bold",
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
                      "flex w-full items-center justify-between px-2 py-2 text-left text-xs font-bold",
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
            </section>

          </aside>
        </div>
      </div>
    </div>
  );
}
