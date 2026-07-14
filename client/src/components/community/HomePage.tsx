'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { igkLevelLabel } from '@/lib/igk-levels';
import {
  ArrowRight,
  ChevronRight,
  Clock3,
  Flame,
  Gift,
  Megaphone,
  MessageCircle,
  PenSquare,
  Search,
  ThumbsUp,
  Trophy,
} from 'lucide-react';
import {
  Avatar,
  BoardBadge,
  BoardMark,
  DeadlineBadge,
  MemberLine,
  PostMetrics,
  SectionTitle,
  SolvedBadge,
  boardStyles,
  cx,
} from './CommunityUI';
import {
  boards,
  formatNumber,
  notices as demoNotices,
  posts as demoPosts,
  ranking as demoRanking,
  type Notice,
  type RankingMember,
  type BoardDefinition,
  type PostSummary,
} from './demo-data';

function HomeActions() {
  return (
    <nav className="grid min-w-0 grid-cols-2 gap-2" aria-label="홈 바로가기">
      <Link
        href="/search"
        className="inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-2 text-xs font-bold text-slate-700 transition-colors hover:border-slate-500 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-emerald-500"
      >
        <Search className="h-3.5 w-3.5" aria-hidden="true" />
        통합검색
      </Link>
      <Link
        href="/boards/question/write"
        className="inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-md bg-emerald-700 px-2 text-xs font-bold text-white transition-colors hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
      >
        <PenSquare className="h-3.5 w-3.5" aria-hidden="true" />
        질문하기
      </Link>
    </nav>
  );
}

function NoticeRail({ items }: { items: Notice[] }) {
  return (
    <aside className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-[0_3px_12px_rgba(51,56,50,0.035)]">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-950 px-5 py-4 text-white">
        <div className="flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-emerald-300" aria-hidden="true" />
          <h2 className="text-sm font-extrabold tracking-[-0.02em]">관리자 공지</h2>
        </div>
        <Link
          href="/notices"
          className="text-[11px] font-semibold text-slate-300 hover:text-white"
        >
          전체 보기
        </Link>
      </div>
      <ol className="divide-y divide-slate-100 px-5">
        {items.map((notice) => (
          <li key={notice.id}>
            <Link
              href={`/notices#notice-${notice.id}`}
              className="group block py-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
            >
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <span
                  className={cx(
                    'text-[10px] font-extrabold',
                    notice.important ? 'text-rose-600' : 'text-emerald-700',
                  )}
                >
                  {notice.label}
                </span>
                <span className="text-[10px] tabular-nums text-slate-400">{notice.date}</span>
              </div>
              <p className="text-sm font-semibold leading-5 text-slate-700 transition-colors group-hover:text-emerald-700">
                {notice.title}
              </p>
            </Link>
          </li>
        ))}
        {items.length === 0 && <li className="py-6 text-center text-xs text-slate-400">공지 없음</li>}
      </ol>
    </aside>
  );
}

function BoardCard({ board, items }: { board: BoardDefinition; items: PostSummary[] }) {
  const boardPosts = items.filter((post) => post.board === board.slug).slice(0, 3);
  const style = boardStyles[board.accent];

  return (
    <article
      className={cx(
        'group flex flex-col rounded-lg border border-stone-200 bg-white p-5 shadow-[0_3px_12px_rgba(51,56,50,0.03)] transition-colors hover:border-emerald-300 sm:p-5',
        style.line,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <BoardMark board={board} />
          <div className="min-w-0">
            <h2 className="text-lg font-black tracking-[-0.03em] text-slate-900">
              {board.title}
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">{board.description}</p>
          </div>
        </div>
        <span className={cx('shrink-0 text-xs font-extrabold', style.text)}>
          +{board.todayCount}
        </span>
      </div>

      <div className="mt-5 flex-1 divide-y divide-slate-100 border-y border-slate-100">
        {boardPosts.map((post) => (
          <Link
            key={post.id}
            href={`/post/${post.id}`}
            className="flex items-start justify-between gap-3 py-3.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                {post.solved && <SolvedBadge />}
                {post.deadline && <DeadlineBadge deadline={post.deadline} />}
                <p className="truncate text-sm font-bold tracking-[-0.015em] text-slate-800 transition-colors group-hover:text-slate-950">
                  {post.title}
                </p>
              </div>
              <p className="mt-1.5 truncate text-[11px] text-slate-400">
                {post.author.nickname} · {post.createdAt}
              </p>
            </div>
            <span className="mt-0.5 shrink-0 text-[11px] font-bold tabular-nums text-slate-400">
              {post.comments}
            </span>
          </Link>
        ))}
      </div>

      <Link
        href={`/boards/${board.slug}`}
        className={cx(
          'mt-4 inline-flex items-center justify-between text-xs font-extrabold',
          style.text,
        )}
      >
        <span>{formatNumber(board.postCount)}개의 이야기 보기</span>
        <ArrowRight
          className="h-4 w-4 transition-transform group-hover:translate-x-1"
          aria-hidden="true"
        />
      </Link>
    </article>
  );
}

function LatestActivity({ items }: { items: PostSummary[] }) {
  const latest = items.slice(0, 8);

  return (
    <section className="rounded-lg border border-stone-200 bg-white px-5 py-4 shadow-[0_3px_12px_rgba(51,56,50,0.03)] sm:px-6">
      <SectionTitle
        title="지금 올라오는 이야기"
        href="/search"
      />
      <div className="border-t border-slate-900">
        {latest.map((post) => (
          <article
            key={post.id}
            className="grid gap-2 border-b border-slate-100 py-3.5 sm:grid-cols-[100px_minmax(0,1fr)_auto] sm:items-center sm:gap-4"
          >
            <div className="flex items-center gap-2 sm:block">
              <BoardBadge slug={post.board} />
              <span className="text-[11px] tabular-nums text-slate-400 sm:mt-1.5 sm:block">
                {post.createdAt}
              </span>
            </div>
            <div className="min-w-0">
              <Link
                href={`/post/${post.id}`}
                className="group flex min-w-0 items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                {post.hot && (
                  <Flame className="h-3.5 w-3.5 shrink-0 text-rose-500" aria-label="인기" />
                )}
                <h3 className="truncate text-sm font-bold text-slate-800 group-hover:text-emerald-700">
                  {post.title}
                </h3>
                <span className="shrink-0 text-xs font-extrabold text-emerald-600">
                  {post.comments}
                </span>
              </Link>
              <div className="mt-1.5">
                <MemberLine member={post.author} compact />
              </div>
            </div>
            <div className="hidden sm:block">
              <PostMetrics post={post} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function HotTopics({ items }: { items: PostSummary[] }) {
  const hotPosts = [...items]
    .filter((post) => post.hot)
    .sort((a, b) => b.likes + b.comments - (a.likes + a.comments))
    .slice(0, 5);

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-[0_3px_12px_rgba(51,56,50,0.03)]">
      <div className="mb-4 flex items-center gap-2">
        <Flame className="h-4 w-4 text-rose-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-slate-900">인기 게시글</h2>
        <span className="ml-auto text-[10px] font-semibold text-slate-400">추천·댓글 기준</span>
      </div>
      <ol className="divide-y divide-slate-100 border-t border-slate-900">
        {hotPosts.map((post, index) => (
          <li key={post.id}>
            <Link
              href={`/post/${post.id}`}
              className="group grid grid-cols-[24px_minmax(0,1fr)] gap-2 py-3.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
            >
              <span
                className={cx(
                  'pt-0.5 text-sm font-black tabular-nums',
                  index < 3 ? 'text-emerald-700' : 'text-slate-300',
                )}
              >
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="line-clamp-2 text-sm font-semibold leading-5 text-slate-700 group-hover:text-emerald-700">
                  {post.title}
                </span>
                <span className="mt-1.5 flex items-center gap-3 text-[10px] text-slate-400">
                  <span>{getBoardLabel(post)}</span>
                  <span className="inline-flex items-center gap-1">
                    <ThumbsUp className="h-3 w-3" aria-hidden="true" />
                    {post.likes}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MessageCircle className="h-3 w-3" aria-hidden="true" />
                    {post.comments}
                  </span>
                </span>
              </span>
            </Link>
          </li>
        ))}
        {hotPosts.length === 0 && (
          <li className="py-6 text-center text-xs text-slate-400">인기 글 없음</li>
        )}
      </ol>
    </section>
  );
}

function getBoardLabel(post: PostSummary) {
  return boards.find((board) => board.slug === post.board)?.shortTitle ?? '';
}

function IgkPanel() {
  return (
    <section className="rounded-lg border border-blue-200 bg-blue-50 p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-blue-200 bg-white text-blue-700">
          <Gift className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-black text-slate-900">함께 쌓는 IGK</p>
          <Link
            href="/igk"
            className="mt-3 inline-flex items-center gap-1 text-xs font-extrabold text-blue-700 hover:underline"
          >
            보상 제도 알아보기
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function RankingPanel({ items }: { items: RankingMember[] }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-[0_3px_12px_rgba(51,56,50,0.03)]">
      <div className="mb-4 flex items-center gap-2">
        <Trophy className="h-4 w-4 text-amber-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-slate-900">보유 IGK 랭킹</h2>
        <span className="ml-auto text-[10px] font-semibold text-slate-400">현재 잔액 기준</span>
      </div>
      <ol className="border-t border-slate-900">
        {items.map((member) => (
          <li
            key={member.studentId}
            className="grid grid-cols-[24px_32px_minmax(0,1fr)_auto] items-center gap-2 border-b border-slate-100 py-3"
          >
            <span
              className={cx(
                'text-center text-xs font-black tabular-nums',
                member.rank <= 3 ? 'text-emerald-700' : 'text-slate-400',
              )}
            >
              {member.rank}
            </span>
            <Avatar member={member} size="sm" />
            <span className="min-w-0">
              <span className="block truncate text-xs font-bold text-slate-700">
                {member.nickname}
              </span>
              <span className="block text-[10px] text-slate-400">
                {member.studentId} · {igkLevelLabel(member.level)}
              </span>
            </span>
            <span className="text-xs font-black tabular-nums text-slate-700">
              {formatNumber(member.igk)}
              <span className="ml-1 text-[9px] font-bold text-slate-400">IGK</span>
            </span>
          </li>
        ))}
        {items.length === 0 && (
          <li className="py-6 text-center text-xs text-slate-400">아직 랭킹이 없어요.</li>
        )}
      </ol>
    </section>
  );
}

function mapHomePost(item: any, slug: PostSummary['board']): PostSummary {
  const nickname = item?.author?.realName || item?.author?.nickname || '알 수 없음';
  const metadata = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {};
  return {
    id: item.id,
    board: slug,
    title: item.title,
    excerpt: item.contentText || '',
    author: {
      nickname,
      studentId: item?.author?.studentIdentity?.studentCode || '------',
      level: Number(item?.author?.level || 1),
      initials: nickname.slice(0, 1),
      profileImage: item?.author?.profileImage || null,
      accent: 'emerald',
    },
    createdAt: new Date(item.publishedAt || item.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    sortAt: new Date(item.publishedAt || item.createdAt).getTime(),
    comments: Number(item.commentCount || 0),
    views: Number(item.viewCount || 0),
    likes: Number(item.recommendationCount || 0),
    tags: Array.isArray(item.tags) ? item.tags : [],
    hot: Number(item.recommendationCount || 0) >= 10,
    solved: Boolean(item.acceptedCommentId),
    notice: Boolean(item.isPinned),
    deadline: typeof metadata.deadline === 'string' ? metadata.deadline : undefined,
  };
}

export default function HomePage() {
  const demoMode = process.env.NEXT_PUBLIC_PORTAL_DEMO_MODE === 'true';
  const [boardItems, setBoardItems] = useState<BoardDefinition[]>(
    demoMode ? boards : boards.map((board) => ({ ...board, postCount: 0, todayCount: 0 })),
  );
  const [homePosts, setHomePosts] = useState<PostSummary[]>(demoMode ? demoPosts : []);
  const [noticeItems, setNoticeItems] = useState<Notice[]>(demoMode ? demoNotices : []);
  const [rankingItems, setRankingItems] = useState<RankingMember[]>(demoMode ? demoRanking : []);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/api/boards', { cache: 'no-store' }).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch('/api/notices?limit=10', { cache: 'no-store' }).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch('/api/igk/ranking', { cache: 'no-store' }).then((response) => response.ok ? response.json() : Promise.reject()),
    ])
      .then(([boardPayload, noticePayload, rankingPayload]) => {
        if (!active) return;
        const apiBoards = boardPayload?.data?.boards || boardPayload?.boards || [];
        const nextPosts: PostSummary[] = [];
        const nextBoards = boards.map((definition) => {
          const board = apiBoards.find((item: any) => item.slug === definition.slug);
          if (!board) return { ...definition, postCount: 0, todayCount: 0 };
          const mapped: PostSummary[] = Array.isArray(board.posts) ? board.posts.map((item: any) => mapHomePost(item, definition.slug)) : [];
          nextPosts.push(...mapped);
          return {
            ...definition,
            title: board.name || definition.title,
            description: board.description || definition.description,
            postCount: Number(board?._count?.posts || 0),
            todayCount: Number(board?.stats?.todayPosts || 0),
            todayCommentCount: Number(board?.stats?.todayComments || 0),
            weeklyPostCount: Number(board?.stats?.weeklyPosts || 0),
            weeklyCommentCount: Number(board?.stats?.weeklyComments || 0),
          };
        });
        const apiNotices = noticePayload?.data?.notices || noticePayload?.notices || [];
        const apiLeaders = rankingPayload?.data?.leaders || rankingPayload?.leaders || [];
        setBoardItems(nextBoards);
        setHomePosts(nextPosts.sort((a, b) => (b.sortAt || 0) - (a.sortAt || 0)));
        setNoticeItems(apiNotices.map((notice: any) => ({
          id: notice.id,
          title: notice.title,
          date: new Date(notice.publishedAt || notice.createdAt).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }).replace(/\. /g, '.').replace('.', ''),
          label: notice.priority >= 50 ? '필독' : '안내',
          important: notice.priority >= 50,
        })));
        setRankingItems(apiLeaders.slice(0, 7).map((leader: any, index: number) => ({
          rank: Number(leader.rank || index + 1),
          nickname: leader.realName || leader.nickname,
          studentId: leader?.studentIdentity?.studentCode || '------',
          level: Number(leader.level || 1),
          initials: String(leader.realName || leader.nickname || '?').slice(0, 1),
          profileImage: leader.profileImage || null,
          accent: 'emerald',
          igk: Number(leader.currentIgk || 0),
          change: 0,
        })));
        setLoaded(true);
      })
      .catch(() => {
        if (active) setLoaded(demoMode);
      });
    return () => { active = false; };
  }, [demoMode]);

  return (
    <div className="min-h-screen min-w-0 overflow-x-hidden px-0 py-2 text-slate-900 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto min-w-0 max-w-[1440px]">
        <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="min-w-0 space-y-3">
            <HomeActions />
            <NoticeRail items={noticeItems} />
            <HotTopics items={homePosts} />
            <RankingPanel items={rankingItems} />
            <IgkPanel />
            <Link
              href="/boards/free/write"
              className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-emerald-700 bg-white px-4 text-xs font-extrabold text-emerald-800 hover:bg-emerald-700 hover:text-white"
            >
              <PenSquare className="h-3.5 w-3.5" aria-hidden="true" />
              새 글 쓰기
            </Link>
          </aside>
          <div className="min-w-0">
            <section aria-label="게시판 둘러보기">
              <div className="mb-4 flex items-center justify-between gap-4">
                <h2 className="text-xl font-black tracking-[-0.035em] text-slate-950">게시판</h2>
                <span className="hidden items-center gap-2 text-xs text-slate-400 sm:inline-flex">
                  <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                  {loaded ? '방금 업데이트됨' : '서버 정보를 불러오는 중…'}
                </span>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {boardItems.map((board) => (
                  <BoardCard key={board.slug} board={board} items={homePosts} />
                ))}
              </div>
            </section>
          </div>
        </div>
        <div className="mt-6">
          <LatestActivity items={homePosts} />
        </div>
      </div>
    </div>
  );
}
