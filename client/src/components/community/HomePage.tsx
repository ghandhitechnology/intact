'use client';

import Link from '@/components/portal/IntentLink';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { igkLevelLabel } from '@/lib/igk-levels';
import { fetchWithTimeout } from '@/lib/client/request';
import { clearClientDataCache, getCachedResource, setCachedResource } from '@/components/portal/ClientDataProvider';
import { usePortalSession } from '@/components/portal/SessionProvider';
import {
  ArrowRight,
  Bell,
  ChevronRight,
  Clock3,
  Coins,
  Eye,
  Flame,
  LogIn,
  LogOut,
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

type HomeAccountUser = {
  id?: string;
  nickname?: string;
  realName?: string;
  studentCode?: string | null;
  level?: number;
  profileImage?: string | null;
};

type HomeAccountStatus = { currentIgk: number; jojinRank: number | null; unreadCount: number };

function HomeAccountPanel({ demoMode, accountStatus }: { demoMode: boolean; accountStatus?: HomeAccountStatus }) {
  const router = useRouter();
  const { session, loading: sessionLoading, refresh: refreshSession } = usePortalSession();
  const [user, setUser] = useState<HomeAccountUser | null>(
    demoMode
      ? { id: 'demo', nickname: '김민준', realName: '김민준', studentCode: '331101', level: 9 }
      : null,
  );
  const [currentIgk, setCurrentIgk] = useState(demoMode ? 1840 : 0);
  const [jojinRank, setJojinRank] = useState<number | null>(null);
  const [unreadCount, setUnreadCount] = useState(demoMode ? 3 : 0);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (demoMode) return undefined;
    if (!session?.authenticated || !session.user) {
      setUser(null);
      setCurrentIgk(0);
      return undefined;
    }
    setUser(session.user);
    setCurrentIgk(Number(session.currentIgk || 0));
    return undefined;
  }, [demoMode, session]);

  useEffect(() => {
    if (!accountStatus) return;
    setCurrentIgk(accountStatus.currentIgk);
    setJojinRank(accountStatus.jojinRank);
    setUnreadCount(accountStatus.unreadCount);
  }, [accountStatus]);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    await fetchWithTimeout('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
    setCurrentIgk(0);
    setJojinRank(null);
    setUnreadCount(0);
    clearClientDataCache();
    await refreshSession();
    setLoggingOut(false);
    router.refresh();
  }

  if (sessionLoading && !demoMode) {
    return (
      <section className="bg-white p-3" aria-label="계정 정보를 불러오는 중">
        <div className="h-10 animate-pulse bg-slate-100" />
        <div className="mt-2 h-8 animate-pulse bg-slate-100" />
      </section>
    );
  }

  if (!user) {
    return (
      <section className="bg-white p-3" aria-labelledby="home-login-title">
        <h2 id="home-login-title" className="text-xs font-black text-slate-800">인텍트 계정</h2>
        <Link
          href="/login?returnTo=%2F"
          className="mt-3 flex h-10 w-full items-center justify-center gap-2 bg-emerald-700 text-xs font-black text-white hover:bg-emerald-800"
        >
          <LogIn className="h-4 w-4" aria-hidden="true" />
          로그인
        </Link>
        <div className="mt-3 flex items-center justify-between text-[10px] font-bold text-slate-500">
          <Link href="/reset-password" className="hover:text-emerald-700">비밀번호 재설정</Link>
          <Link href="/register" className="text-emerald-700 hover:text-emerald-900">회원가입</Link>
        </div>
      </section>
    );
  }

  const displayName = user.realName || user.nickname || '사용자';
  const studentCode = user.studentCode || '------';
  const level = Number(user.level || 1);
  const avatarMember = {
    nickname: displayName,
    studentId: studentCode,
    level,
    jojinRank,
    initials: displayName.slice(0, 1),
    profileImage: user.profileImage || null,
    accent: 'emerald' as const,
  };

  return (
    <section className="bg-white p-3" aria-labelledby="home-account-title">
      <p className="text-[10px] font-bold text-emerald-700">로그인 중</p>
      <Link href="/profile" className="mt-2 flex items-center gap-2.5 hover:bg-slate-50">
        <Avatar member={avatarMember} />
        <span className="min-w-0 flex-1">
          <strong id="home-account-title" className="block truncate text-xs font-black text-slate-900">{displayName}</strong>
          <span className="mt-0.5 block truncate text-[10px] text-slate-500">{studentCode} · {igkLevelLabel(level, jojinRank)}</span>
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" aria-hidden="true" />
      </Link>
      <div className="mt-3 grid grid-cols-3 gap-1 bg-slate-50 p-1">
        <Link href="/messages" className="flex min-h-12 flex-col items-center justify-center gap-1 bg-white text-[10px] font-bold text-slate-600 hover:text-emerald-700">
          <MessageCircle className="h-4 w-4" aria-hidden="true" />대화
        </Link>
        <Link href="/notifications" className="relative flex min-h-12 flex-col items-center justify-center gap-1 bg-white text-[10px] font-bold text-slate-600 hover:text-emerald-700">
          <Bell className={cx('h-4 w-4', unreadCount > 0 && 'text-red-900')} aria-hidden="true" />알림
          {unreadCount > 0 ? <span className="absolute right-1.5 top-1 bg-red-900 px-1 text-[9px] text-white">{Math.min(unreadCount, 99)}</span> : null}
        </Link>
        <Link href="/igk" className="flex min-h-12 flex-col items-center justify-center gap-1 bg-white text-[10px] font-bold text-slate-600 hover:text-emerald-700">
          <Coins className="h-4 w-4" aria-hidden="true" />{currentIgk.toLocaleString()}
        </Link>
      </div>
      <button
        type="button"
        onClick={() => void logout()}
        disabled={loggingOut}
        className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-slate-700 disabled:opacity-50"
      >
        <LogOut className="h-3 w-3" aria-hidden="true" />
        {loggingOut ? '로그아웃 중…' : '로그아웃'}
      </button>
    </section>
  );
}

function HomeActions() {
  return (
    <nav className="grid min-w-0 grid-cols-2 gap-2" aria-label="홈 바로가기">
      <Link
        href="/search"
        className="inline-flex h-9 min-w-0 items-center justify-center gap-2 border border-slate-300 bg-white px-2 text-[11px] font-bold text-slate-700 transition-colors hover:border-slate-500 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-emerald-500"
      >
        <Search className="h-3.5 w-3.5" aria-hidden="true" />
        통합검색
      </Link>
      <Link
        href="/boards/free/write"
        className="inline-flex h-9 min-w-0 items-center justify-center gap-2 bg-emerald-700 px-2 text-[11px] font-bold text-white transition-colors hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
      >
        <PenSquare className="h-3.5 w-3.5" aria-hidden="true" />
        글쓰기
      </Link>
    </nav>
  );
}

function PortalMenu({ items }: { items: BoardDefinition[] }) {
  return (
    <section className="border border-slate-200 bg-white">
      <div className="border-b border-slate-800 px-4 py-3">
        <h2 className="text-xs font-black text-slate-900">게시판 바로가기</h2>
      </div>
      <nav className="divide-y divide-slate-100" aria-label="게시판 바로가기">
        {items.map((board) => (
          <Link
            key={board.slug}
            href={`/boards/${board.slug}`}
            className="group flex min-h-11 items-center gap-2.5 px-3.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 hover:text-emerald-800"
          >
            <BoardMark board={board} size="sm" />
            <span className="min-w-0 flex-1 truncate">{board.title}</span>
            {board.todayCount > 0 ? (
              <span className="text-[10px] font-black tabular-nums text-emerald-700">
                +{board.todayCount}
              </span>
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-emerald-600" />
            )}
          </Link>
        ))}
      </nav>
      <div className="grid grid-cols-2 border-t border-slate-200 bg-slate-50">
        <Link href="/messages" className="border-r border-slate-200 px-3 py-2.5 text-center text-[10px] font-bold text-slate-600 hover:text-emerald-700">대화</Link>
        <Link href="/notifications" className="px-3 py-2.5 text-center text-[10px] font-bold text-slate-600 hover:text-emerald-700">알림</Link>
      </div>
    </section>
  );
}

function NoticeRail({ items }: { items: Notice[] }) {
  return (
    <aside className="overflow-hidden border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <Megaphone className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
          <h2 className="text-xs font-black tracking-[-0.02em] text-slate-900">관리자 공지</h2>
        </div>
        <Link
          href="/notices"
          className="text-[10px] font-bold text-slate-400 hover:text-emerald-700"
        >
          전체 보기
        </Link>
      </div>
      <ol className="divide-y divide-slate-100 px-4">
        {items.slice(0, 5).map((notice) => (
          <li key={notice.id}>
            <Link
              href={`/notices#notice-${notice.id}`}
              className="group block py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
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
              <p className="line-clamp-2 text-xs font-semibold leading-5 text-slate-700 transition-colors group-hover:text-emerald-700">
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
        'render-lazy group flex flex-col border border-slate-200 bg-white p-4 transition-colors hover:border-emerald-300',
        style.line,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <BoardMark board={board} size="sm" />
          <div className="min-w-0">
            <h2 className="text-sm font-black tracking-[-0.025em] text-slate-900">
              {board.title}
            </h2>
            <p className="mt-0.5 line-clamp-1 text-[10px] leading-4 text-slate-500">{board.description}</p>
          </div>
        </div>
        <span className={cx('shrink-0 text-xs font-extrabold', style.text)}>
          +{board.todayCount}
        </span>
      </div>

      <div className="mt-3 flex-1 divide-y divide-slate-100 border-y border-slate-100">
        {boardPosts.map((post) => (
          <Link
            key={post.id}
            href={`/post/${post.id}`}
            className="flex items-start justify-between gap-3 py-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                {post.solved && <SolvedBadge />}
                {post.deadline && <DeadlineBadge deadline={post.deadline} />}
                <p className="truncate text-xs font-bold tracking-[-0.015em] text-slate-800 transition-colors group-hover:text-emerald-700">
                  {post.title}
                </p>
              </div>
              <p className="mt-1 truncate text-[10px] text-slate-400">
                {post.author.nickname} · {post.createdAt}
              </p>
            </div>
            <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-[11px] font-bold tabular-nums text-slate-400" title="조회수">
              <Eye className="h-3 w-3" aria-hidden="true" />
              {post.views}
            </span>
          </Link>
        ))}
      </div>

      <Link
        href={`/boards/${board.slug}`}
        className={cx(
          'mt-3 inline-flex items-center justify-between text-[11px] font-extrabold',
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
    <section className="border border-slate-200 bg-white px-3 py-2 sm:px-4">
      <div className="flex h-8 items-center justify-between gap-4">
        <h2 className="text-sm font-black tracking-[-0.02em] text-slate-900">
          지금 올라오는 이야기
        </h2>
        <Link
          href="/search"
          className="text-[11px] font-bold text-slate-500 underline decoration-slate-300 underline-offset-4 hover:text-emerald-700"
        >
          전체 보기
        </Link>
      </div>
      <div className="border-t border-slate-900">
        {latest.map((post) => (
          <article
            key={post.id}
            className="render-lazy grid grid-cols-[68px_minmax(0,1fr)] items-center gap-2 border-b border-slate-100 py-2 sm:grid-cols-[68px_92px_minmax(0,1fr)_150px_auto] sm:gap-3"
          >
            <div className="min-w-0">
              <BoardBadge slug={post.board} />
              <span className="mt-1 block whitespace-nowrap text-[10px] tabular-nums text-slate-400 sm:hidden">
                {post.createdAt}
              </span>
            </div>
            <span className="hidden whitespace-nowrap text-[10px] tabular-nums text-slate-400 sm:block">
              {post.createdAt}
            </span>
            <div className="min-w-0">
              <Link
                href={`/post/${post.id}`}
                className="group flex min-w-0 items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                {post.hot && (
                  <Flame className="h-3.5 w-3.5 shrink-0 text-rose-500" aria-label="인기" />
                )}
                <h3 className="truncate text-xs font-bold text-slate-800 group-hover:text-emerald-700 sm:text-[13px]">
                  {post.title}
                </h3>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-extrabold text-emerald-700" title="조회수">
                  <Eye className="h-3 w-3" aria-hidden="true" />
                  {post.views}
                </span>
              </Link>
              <div className="mt-1 sm:hidden">
                <MemberLine member={post.author} compact />
              </div>
            </div>
            <div className="hidden min-w-0 sm:block">
              <MemberLine member={post.author} compact />
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
    <section className="border border-slate-200 bg-white p-4">
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

function RankingPanel({ items }: { items: RankingMember[] }) {
  return (
    <section className="border border-slate-200 bg-white p-4">
      <div className="mb-4 flex items-center gap-2">
        <Trophy className="h-4 w-4 text-amber-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-slate-900">보유 IGK 랭킹</h2>
        <span className="ml-auto text-[10px] font-semibold text-slate-400">현재 잔액 기준</span>
      </div>
      <ol className="border-t border-slate-900">
        {items.slice(0, 5).map((member) => (
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
                {member.studentId !== '------' ? `${member.studentId} · ` : ''}{igkLevelLabel(member.level, member.jojinRank)}
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
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'partial' | 'error'>(demoMode ? 'ready' : 'loading');
  const [reloadKey, setReloadKey] = useState(0);
  const [homePayload, setHomePayload] = useState<any>(null);
  const [homeError, setHomeError] = useState<Error | null>(null);
  const [homeLoading, setHomeLoading] = useState(!demoMode);

  useEffect(() => {
    if (demoMode) return undefined;
    let active = true;
    const controller = new AbortController();
    const cached = getCachedResource<any>('/api/home', 90_000);
    if (cached) {
      setHomePayload(cached);
      setHomeLoading(false);
    }
    async function loadHome() {
      setHomeError(null);
      try {
        const response = await fetchWithTimeout('/api/home', { cache: 'no-cache', signal: controller.signal });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body) throw new Error('LOAD_FAILED');
        const data = body.data ?? body;
        if (!active) return;
        setHomePayload(data);
        setCachedResource('/api/home', data);
      } catch (cause) {
        if (active) setHomeError(cause instanceof Error ? cause : new Error('LOAD_FAILED'));
      } finally {
        if (active) setHomeLoading(false);
      }
    }
    void loadHome();
    return () => { active = false; controller.abort(); };
  }, [demoMode, reloadKey]);

  useEffect(() => {
    if (demoMode) return undefined;
    if (!homePayload) {
      setLoadState(homeError ? 'error' : 'loading');
      return undefined;
    }
          const apiBoards = homePayload.boards || [];
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
          setBoardItems(nextBoards);
          setHomePosts(nextPosts.sort((a, b) => (b.sortAt || 0) - (a.sortAt || 0)));
          const apiNotices = homePayload.notices || [];
          setNoticeItems(apiNotices.map((notice: any) => ({
            id: notice.id,
            title: notice.title,
            date: new Date(notice.publishedAt || notice.createdAt).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }).replace(/\. /g, '.').replace('.', ''),
            label: notice.priority >= 50 ? '필독' : '안내',
            important: notice.priority >= 50,
          })));
          const apiLeaders = homePayload.leaders || [];
          setRankingItems(apiLeaders.slice(0, 7).map((leader: any, index: number) => ({
            rank: Number(leader.rank || index + 1),
            nickname: leader.realName || leader.nickname,
            studentId: leader?.studentIdentity?.studentCode || '------',
            level: Number(leader.level || 1),
            jojinRank: Number.isInteger(leader.jojinRank) ? Number(leader.jojinRank) : null,
            initials: String(leader.realName || leader.nickname || '?').slice(0, 1),
            profileImage: leader.profileImage || null,
            accent: 'emerald',
            igk: Number(leader.currentIgk || 0),
            change: 0,
          })));
    setLoadState('ready');
    return undefined;
  }, [demoMode, homeError, homePayload, reloadKey]);

  return (
    <div className="min-h-screen min-w-0 overflow-x-hidden py-1 text-slate-900 sm:py-3">
      <div className="mx-auto min-w-0 max-w-[1540px]">
        <div className="grid min-w-0 items-start gap-3 lg:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_280px]">
          <aside className="hidden min-w-0 space-y-3 lg:sticky lg:top-[100px] lg:block">
            <HomeActions />
            <PortalMenu items={boardItems} />
          </aside>
          <div className="min-w-0">
            <section aria-label="게시판 둘러보기">
              <div className="mb-3 flex min-h-9 items-center justify-between gap-4 border-b border-slate-800 bg-white px-1">
                <h1 className="text-sm font-black tracking-[-0.025em] text-slate-950">인텍트 게시판</h1>
                <span className="hidden items-center gap-2 text-xs text-slate-400 sm:inline-flex">
                  <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                  {loadState === 'ready' ? '방금 업데이트됨' : homeLoading || loadState === 'loading' ? '정보를 불러오는 중…' : '일부 정보를 불러오지 못함'}
                </span>
                {(loadState === 'partial' || loadState === 'error') ? (
                  <button type="button" onClick={() => setReloadKey((value) => value + 1)} className="text-xs font-bold text-amber-800 underline underline-offset-2">
                    다시 불러오기
                  </button>
                ) : null}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {boardItems.map((board) => (
                  <BoardCard key={board.slug} board={board} items={homePosts} />
                ))}
              </div>
            </section>
            <div className="mt-3">
              <LatestActivity items={homePosts} />
            </div>
          </div>
          <aside className="grid min-w-0 gap-3 md:grid-cols-3 lg:col-span-2 xl:col-span-1 xl:sticky xl:top-[100px] xl:block xl:space-y-3">
            <HomeAccountPanel demoMode={demoMode} accountStatus={homePayload?.account} />
            <NoticeRail items={noticeItems} />
            <HotTopics items={homePosts} />
            <RankingPanel items={rankingItems} />
          </aside>
        </div>
      </div>
    </div>
  );
}
