'use client';

import {
  Bell,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Coins,
  FileText,
  HelpCircle,
  Home,
  LogIn,
  Menu,
  MessageSquare,
  Microscope,
  Image as PhotoIcon,
  Search,
  Trophy,
  User,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { igkLevelLabel } from '@/lib/igk-levels';
import { fetchWithTimeout, isAbortError } from '@/lib/client/request';

const navigation = [
  { href: '/', label: '홈', icon: Home },
  { href: '/boards/question', label: '질문게시판', icon: HelpCircle },
  { href: '/boards/contest', label: '대회모집', icon: Users },
  { href: '/boards/resources', label: '자료공유', icon: FileText },
  { href: '/boards/equipment', label: '심화기기', icon: Microscope },
  { href: '/boards/free', label: '자유게시판', icon: MessageSquare },
  { href: '/boards/photos', label: '사진게시판', icon: PhotoIcon },
];
const boardNavigation = navigation.slice(1);

const PUBLIC_PATHS = new Set(['/login', '/register', '/reset-password', '/privacy', '/rules', '/terms', '/offline', '/reverify']);
const DEMO_MODE = process.env.NEXT_PUBLIC_PORTAL_DEMO_MODE === 'true';
const DEMO_USER = { nickname: '김민준', realName: '김민준', studentCode: '331101', igkBalance: 1840, level: 12 };

function requiresPortalSession(pathname: string) {
  return !PUBLIC_PATHS.has(pathname) && !pathname.startsWith('/admin');
}

type SessionUser = {
  id?: string;
  nickname?: string;
  realName?: string;
  profileImage?: string | null;
  studentId?: string | number;
  studentCode?: string;
  igkBalance?: number;
  level?: number;
};

export default function PortalShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '/';
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [boardPickerOpen, setBoardPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(DEMO_MODE ? DEMO_USER : null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [sessionCheckFailed, setSessionCheckFailed] = useState(false);
  const [sessionRefreshKey, setSessionRefreshKey] = useState(0);
  const sessionUserKey = sessionUser?.id || sessionUser?.studentCode || '';

  useEffect(() => {
    if (DEMO_MODE) return;
    let active = true;
    const controller = new AbortController();
    fetchWithTimeout('/api/auth/session', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => ({ response, data: await response.json().catch(() => null) }))
      .then(({ response, data }) => {
        if (!active) return;
        const authState = data?.data?.authenticated ?? data?.authenticated;
        if (!response.ok || typeof authState !== 'boolean') {
          throw new Error('SESSION_CHECK_FAILED');
        }
        setSessionCheckFailed(false);
        const reason = data?.data?.reason || data?.reason;
        if (reason === 'PENDING_REVERIFICATION' && pathname !== '/reverify') {
          router.replace('/reverify');
          return;
        }
        const user = data?.data?.user || data?.user;
        if (!authState && requiresPortalSession(pathname)) {
          setSessionUser(null);
          router.replace(`/login?returnTo=${encodeURIComponent(pathname)}`);
          return;
        }
        setSessionUser(user || null);
      })
      .catch((error) => {
        if (active && !isAbortError(error)) setSessionCheckFailed(true);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [pathname, router, sessionRefreshKey]);

  useEffect(() => {
    const refresh = () => setSessionRefreshKey((value) => value + 1);
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  useEffect(() => {
    if (!sessionUserKey) return;
    let active = true;
    let controller: AbortController | null = null;
    const loadUnread = () => {
      if (document.visibilityState === 'hidden') return;
      controller?.abort();
      controller = new AbortController();
      fetchWithTimeout('/api/notifications?pageSize=1', {
        cache: 'no-store',
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => {
          if (active && body) setUnreadCount(Number(body?.data?.unreadCount || body?.unreadCount || 0));
        })
        .catch(() => undefined);
    };
    loadUnread();
    const timer = window.setInterval(loadUnread, 60_000);
    window.addEventListener('focus', loadUnread);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', loadUnread);
    };
  }, [sessionUserKey]);

  useEffect(() => {
    setMobileOpen(false);
    setAccountOpen(false);
    setBoardPickerOpen(false);
  }, [pathname]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const normalized = query.trim();
    if (normalized) router.push(`/search?q=${encodeURIComponent(normalized)}`);
  }

  async function logout() {
    await fetchWithTimeout('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setSessionUser(null);
    setUnreadCount(0);
    router.replace('/login');
    router.refresh();
  }

  const isAdmin = pathname.startsWith('/admin');
  const isFilePreview = pathname.startsWith('/preview/');
  const isFocusedAuth = ['/login', '/register', '/reset-password', '/reverify'].includes(pathname);
  const currentBoardSlug = pathname.match(/^\/boards\/([^/]+)/)?.[1];
  const currentBoard = boardNavigation.find((item) => item.href === `/boards/${currentBoardSlug}`);
  const writeHref = `${currentBoard?.href ?? '/boards/free'}/write`;

  if (isFocusedAuth) {
    return <div className="min-h-screen bg-[#f7f7f3]">{children}</div>;
  }

  if (isFilePreview) {
    return <div className="min-h-dvh bg-black text-white">{children}</div>;
  }

  return (
    <div className="min-h-screen bg-[var(--surface-muted)] text-[var(--ink)]">
      <header className={`${isAdmin ? 'hidden' : 'sticky'} top-0 z-50 border-b border-[var(--line-strong)] bg-white`}>
        <div className="utility-bar hidden border-b border-[var(--line)] lg:block">
          <div className="portal-container flex h-8 items-center justify-between text-[11px] text-[var(--ink-soft)]">
            <span />
            <div className="flex items-center gap-5">
              <Link href="/notifications" className="hover:text-[var(--blue)]">알림 설정</Link>
              <Link href="/admin" className="hover:text-[var(--blue)]">관리자</Link>
              <Link href="/notices" className="hover:text-[var(--blue)]">운영 공지</Link>
            </div>
          </div>
        </div>

        <div className="portal-container portal-header-container flex h-[68px] items-center gap-4 lg:h-[76px]">
          <button
            type="button"
            className="icon-button lg:hidden"
            aria-label={mobileOpen ? '메뉴 닫기' : '메뉴 열기'}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((value) => !value)}
          >
            {mobileOpen ? <X size={21} /> : <Menu size={21} />}
          </button>

          <Link href="/" className="group flex shrink-0 items-center" aria-label="인텍트 홈">
            <span>
              <span className="block text-[19px] font-black leading-none tracking-[-0.06em] text-[var(--ink)] lg:text-[22px]">
                인텍트
              </span>
            </span>
          </Link>

          <form onSubmit={submitSearch} className="ml-auto hidden max-w-[520px] flex-1 md:block lg:ml-8">
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">통합검색</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="게시글, 자료, 학번 검색"
                autoComplete="off"
              />
            </label>
          </form>

          <div className="ml-auto flex items-center gap-1">
            <Link href="/messages" className="icon-button hidden sm:grid" aria-label="쪽지와 채팅">
              <MessageSquare size={19} />
            </Link>
            <Link href="/notifications" className="icon-button" aria-label="알림">
              <Bell size={19} />
              {unreadCount > 0 && <span className="notification-count">{Math.min(unreadCount, 99)}</span>}
            </Link>
            {sessionUser ? (
              <div className="relative">
                <button
                  type="button"
                  className="account-trigger"
                  onClick={() => setAccountOpen((value) => !value)}
                  aria-expanded={accountOpen}
                >
                  <span className="avatar avatar-sm bg-cover bg-center" style={sessionUser.profileImage ? { backgroundImage: `url(${sessionUser.profileImage})` } : undefined}>{sessionUser.profileImage ? <span className="sr-only">프로필 이미지</span> : (sessionUser.realName || sessionUser.nickname || '사용자').slice(0, 1)}</span>
                  <span className="hidden text-left lg:block">
                    <strong>{sessionUser.realName || sessionUser.nickname || '사용자'}</strong>
                    <small>{sessionUser.studentCode || sessionUser.studentId || '------'} · {igkLevelLabel(sessionUser.level || 1)}</small>
                  </span>
                  <ChevronDown size={14} className="hidden text-[var(--ink-faint)] lg:block" />
                </button>
                {accountOpen && (
                  <div className="account-menu">
                    <div className="border-b border-[var(--line)] px-4 py-3">
                      <p className="text-sm font-bold">{sessionUser.realName || sessionUser.nickname || '사용자'}</p>
                      <p className="mt-0.5 text-xs text-[var(--ink-soft)]">{sessionUser.studentCode || sessionUser.studentId || '------'} · 인천과학고</p>
                    </div>
                    <Link href="/profile" className="account-menu-item"><User size={16} />내 프로필</Link>
                    <Link href="/igk" className="account-menu-item"><Coins size={16} />IGK 지갑</Link>
                    <Link href="/igk/roadmap" className="account-menu-item"><Trophy size={16} />등급 로드맵</Link>
                    <button type="button" onClick={logout} className="account-menu-item w-full text-left"><LogIn size={16} />로그아웃</button>
                  </div>
                )}
              </div>
            ) : (
              <Link href="/login" className="primary-button h-9 px-4 text-xs">로그인</Link>
            )}
          </div>
        </div>

        <nav className="hidden border-t border-[var(--line)] lg:block" aria-label="주요 게시판">
          <div className="portal-container flex h-11 items-stretch">
            {navigation.map((item) => {
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href} className={`nav-link ${active ? 'is-active' : ''}`}>
                  <item.icon size={15} />
                  {item.label}
                </Link>
              );
            })}
            <Link href="/igk?tab=ranking" className="ml-auto flex items-center gap-1.5 border-l border-[var(--line)] px-4 text-xs font-bold text-[var(--green-deep)] hover:bg-[var(--green-pale)]">
              <Trophy size={14} /> 보유 IGK 랭킹
            </Link>
          </div>
        </nav>

        {mobileOpen && (
          <div className="mobile-menu border-t border-[var(--line-strong)] bg-white lg:hidden">
            <form onSubmit={submitSearch} className="p-4 md:hidden">
              <label className="search-field">
                <Search size={17} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="인텍트 통합검색" />
              </label>
            </form>
            <div className="grid grid-cols-2 border-t border-[var(--line)] sm:grid-cols-3">
              {navigation.map((item) => (
                <Link key={item.href} href={item.href} className="mobile-nav-link">
                  <item.icon size={18} /> {item.label}
                </Link>
              ))}
              <Link href="/igk" className="mobile-nav-link"><Coins size={18} />IGK 지갑</Link>
              <Link href="/igk/roadmap" className="mobile-nav-link"><Trophy size={18} />등급 로드맵</Link>
            </div>
          </div>
        )}
      </header>

      {sessionCheckFailed && !isAdmin ? (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-xs text-amber-950" role="status">
          서버 연결이 불안정합니다.
          <button type="button" className="ml-2 font-bold underline underline-offset-2" onClick={() => setSessionRefreshKey((value) => value + 1)}>
            다시 연결
          </button>
        </div>
      ) : null}

      <main id="main-content" className={isAdmin ? 'min-h-[calc(100vh-120px)]' : 'portal-container min-h-[calc(100vh-240px)] py-5 lg:py-7'}>
        {children}
      </main>

      {!isAdmin && (
        <footer className="mt-12 border-t border-[var(--line-strong)] bg-white">
          <div className="portal-container grid gap-8 py-8 md:grid-cols-[1.4fr_1fr_1fr]">
            <div>
              <strong>인텍트</strong>
            </div>
            <div className="footer-links">
              <strong>이용 안내</strong>
              <Link href="/notices">공지사항</Link>
              <Link href="/rules">커뮤니티 규칙</Link>
              <Link href="/privacy">개인정보 처리방침</Link>
            </div>
            <div className="footer-links">
              <strong>도움</strong>
              <Link href="/support">문의·신고</Link>
              <span>운영: 하태욱</span>
              <a href="tel:01085121201">010-8512-1201</a>
              <a href="mailto:tataboxprotein@gmail.com">tataboxprotein@gmail.com</a>
              <span>© 2026 인텍트</span>
            </div>
          </div>
        </footer>
      )}

      {!isAdmin && (
        <div className={`fixed inset-0 z-[70] lg:hidden ${boardPickerOpen ? '' : 'pointer-events-none'}`} aria-hidden={!boardPickerOpen}>
          <button type="button" aria-label="게시판 선택 닫기" onClick={() => setBoardPickerOpen(false)} className={`absolute inset-0 bg-slate-950/45 transition-opacity ${boardPickerOpen ? 'opacity-100' : 'opacity-0'}`} />
          <section className={`absolute inset-x-0 bottom-0 border-t border-slate-300 bg-white px-4 pb-[calc(82px+env(safe-area-inset-bottom))] pt-3 transition-transform duration-200 ${boardPickerOpen ? 'translate-y-0' : 'translate-y-full'}`} aria-label="게시판 선택">
            <div className="mx-auto mb-4 h-1.5 w-10  bg-slate-200" />
            <div className="mb-4 flex items-center justify-between px-1"><h2 className="text-lg font-black tracking-[-0.03em] text-slate-950">게시판 선택</h2><button type="button" onClick={() => setBoardPickerOpen(false)} className="grid h-10 w-10 place-items-center  bg-slate-100 text-slate-600" aria-label="닫기"><X size={18} /></button></div>
            <div className="grid grid-cols-2 gap-2.5">
              {boardNavigation.map((item) => <Link key={item.href} href={item.href} className={`flex min-h-[72px] items-center gap-3  border p-3.5 ${pathname.startsWith(item.href) ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-700'}`}><span className="grid h-10 w-10 place-items-center  bg-white"><item.icon size={19} /></span><span className="min-w-0 flex-1 text-sm font-extrabold">{item.label}</span><ChevronRight size={15} className="text-slate-300" /></Link>)}
            </div>
          </section>
        </div>
      )}

      {!isAdmin && (
        <nav className="mobile-bottom-nav lg:hidden" aria-label="모바일 주요 메뉴">
          <Link href="/" className={pathname === '/' ? 'is-active' : ''}><Home size={19} /><span>홈</span></Link>
          <button type="button" onClick={() => setBoardPickerOpen(true)} className={pathname.startsWith('/boards') ? 'is-active' : ''} aria-expanded={boardPickerOpen}><BookOpen size={19} /><span>게시판</span></button>
          <Link href={writeHref}><span className="mobile-compose">+</span><span>글쓰기</span></Link>
          <Link href="/messages" className={pathname.startsWith('/messages') ? 'is-active' : ''}><MessageSquare size={19} /><span>대화</span></Link>
          <Link href="/profile" className={pathname.startsWith('/profile') ? 'is-active' : ''}><User size={19} /><span>내 정보</span></Link>
        </nav>
      )}
    </div>
  );
}
