'use client';

import {
  Bell,
  BookOpen,
  ChevronRight,
  Coins,
  FileText,
  HelpCircle,
  Home,
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
import Link from '@/components/portal/IntentLink';
import { usePathname, useRouter } from 'next/navigation';
import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { usePortalSession } from '@/components/portal/SessionProvider';
import { usePlatformMode } from '@/components/portal/PlatformModeProvider';

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

const PUBLIC_PATHS = new Set(['/', '/login', '/register', '/reset-password', '/privacy', '/rules', '/terms', '/offline', '/reverify']);
const DEMO_MODE = process.env.NEXT_PUBLIC_PORTAL_DEMO_MODE === 'true';

function requiresPortalSession(pathname: string) {
  return !PUBLIC_PATHS.has(pathname) && !pathname.startsWith('/admin');
}

export default function PortalShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '/';
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [boardPickerOpen, setBoardPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { session, loading: sessionLoading, error: sessionError, refresh: refreshSession } = usePortalSession();
  const { bSideEnabled } = usePlatformMode();
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (DEMO_MODE || !session) return;
    if (session.reason === 'PENDING_REVERIFICATION' && pathname !== '/reverify') {
      router.replace('/reverify');
      return;
    }
    if (!session.authenticated && requiresPortalSession(pathname)) {
      router.replace(`/login?returnTo=${encodeURIComponent(pathname)}`);
    }
  }, [pathname, router, session]);

  useEffect(() => {
    setMobileOpen(false);
    setBoardPickerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen && !boardPickerOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMobileOpen(false);
      setBoardPickerOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [boardPickerOpen, mobileOpen]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const commandShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      const slashShortcut = event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (!commandShortcut && !slashShortcut) return;
      if (!window.matchMedia('(min-width: 768px)').matches) return;
      const target = event.target as HTMLElement | null;
      if (
        slashShortcut &&
        (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName || ''))
      ) return;
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const normalized = query.trim();
    if (normalized) router.push(`/search?q=${encodeURIComponent(normalized)}`);
  }

  const isAdmin = pathname.startsWith('/admin');
  const isFilePreview = pathname.startsWith('/preview/');
  const isFocusedAuth = ['/login', '/register', '/reset-password', '/reverify'].includes(pathname);
  const currentBoardSlug = pathname.match(/^\/boards\/([^/]+)/)?.[1];
  const currentBoard = boardNavigation.find((item) => item.href === `/boards/${currentBoardSlug}`);
  const writeHref = `${currentBoard?.href ?? '/boards/free'}/write`;
  const portalNavigationAvailable = DEMO_MODE || session?.authenticated === true;
  const signedOut = !DEMO_MODE && !sessionLoading && session?.authenticated === false;

  if (isFocusedAuth) {
    return <div className="min-h-screen bg-[var(--surface-muted)]">{children}</div>;
  }

  if (isFilePreview) {
    return <div className="min-h-dvh bg-black text-white">{children}</div>;
  }

  return (
    <div className={`${isAdmin ? '' : 'portal-shell'} min-h-screen bg-[var(--surface-muted)] text-[var(--ink)]`}>
      <header inert={boardPickerOpen} className={`portal-header ${isAdmin ? 'hidden' : 'sticky'} top-0 z-50 border-b border-[var(--line-strong)] bg-white`}>
        <div className="utility-bar hidden border-b border-[var(--line)] lg:block">
          <div className="portal-container flex h-7 items-center justify-between text-xs text-[var(--ink-soft)]">
            <span />
            {portalNavigationAvailable ? (
              <div className="flex items-center gap-5">
                <Link href="/notifications" className="hover:text-[var(--blue)]">알림 설정</Link>
                <Link href="/admin" className="hover:text-[var(--blue)]">관리자</Link>
                <Link href="/notices" className="hover:text-[var(--blue)]">운영 공지</Link>
              </div>
            ) : signedOut ? (
              <div className="flex items-center gap-5">
                <Link href="/register" className="hover:text-[var(--blue)]">회원가입</Link>
                <Link href="/admin" className="hover:text-[var(--blue)]">관리자</Link>
              </div>
            ) : <span />}
          </div>
        </div>

        <div className="portal-container portal-header-container flex h-14 items-center gap-3 lg:h-[60px]">
          {(portalNavigationAvailable || signedOut) ? <button
            type="button"
            className="icon-button header-icon-button lg:hidden"
            aria-label={mobileOpen ? '메뉴 닫기' : '메뉴 열기'}
            aria-expanded={mobileOpen}
            aria-controls="mobile-portal-menu"
            onClick={() => setMobileOpen((value) => !value)}
          >
            {mobileOpen ? <X size={21} /> : <Menu size={21} />}
          </button> : null}

          <Link href="/" className="group flex shrink-0 items-center gap-3" aria-label="인텍트 홈">
            <span className="block text-[20px] font-bold leading-none tracking-[-0.045em] text-[var(--ink)] lg:text-[22px]">
              인텍트
            </span>
            <span className="hidden border-l border-[var(--line-strong)] pl-3 text-xs leading-4 text-[var(--ink-soft)] sm:block">
              인천과학고<br />생활 포털
            </span>
          </Link>
          {bSideEnabled ? (
            <span className="b-side-mark shrink-0 px-2 py-1 text-xs font-bold tracking-[0.18em]">
              B-SIDE
            </span>
          ) : null}

          {portalNavigationAvailable ? <form onSubmit={submitSearch} className="ml-auto hidden max-w-[480px] flex-1 md:block lg:ml-6">
            <label className="search-field header-search-field">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">통합검색</span>
              <input
                ref={searchInputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={bSideEnabled ? '게시글, 자료, 익명 해시 검색' : '게시글, 자료, 학번 검색'}
                autoComplete="off"
                aria-keyshortcuts="/ Control+K Meta+K"
              />
              <kbd className="hidden lg:inline" aria-hidden="true">/</kbd>
            </label>
          </form> : signedOut ? (
            <Link href="/login?returnTo=%2F" className="ml-auto hidden min-h-9 items-center bg-[var(--green)] px-5 text-xs font-bold text-white sm:inline-flex">
              로그인
            </Link>
          ) : null}

          {portalNavigationAvailable ? <div className="ml-auto flex items-center md:hidden">
            <Link href="/search" className="icon-button header-icon-button" aria-label="통합검색">
              <Search size={20} />
            </Link>
            <Link href="/notifications" className="icon-button header-icon-button" aria-label="알림">
              <Bell size={20} />
            </Link>
          </div> : null}

        </div>

        {portalNavigationAvailable ? <nav className="hidden border-t border-[var(--line)] lg:block" aria-label="주요 게시판">
          <div className="portal-container flex h-10 items-center gap-7 overflow-x-auto">
            {navigation.map((item) => {
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`relative flex h-full shrink-0 items-center text-[13px] font-medium transition-colors ${active ? 'text-[var(--green-deep)] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-[var(--green)]' : 'text-[var(--ink-soft)] hover:text-[var(--ink)]'}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav> : null}

        {mobileOpen && (
          <div id="mobile-portal-menu" className="mobile-menu border-t border-[var(--line-strong)] bg-white lg:hidden">
            <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
              <div>
                <p className="text-sm font-bold text-[var(--ink)]">전체 메뉴</p>
              </div>
              <button type="button" className="icon-button" onClick={() => setMobileOpen(false)} aria-label="전체 메뉴 닫기"><X size={20} /></button>
            </div>
            {portalNavigationAvailable ? <form onSubmit={submitSearch} className="p-4 md:hidden">
              <label className="search-field">
                <Search size={17} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={bSideEnabled ? '게시글, 익명 해시 검색' : '인텍트 통합검색'} />
              </label>
            </form> : null}
            {portalNavigationAvailable ? <div className="grid grid-cols-2 border-t border-[var(--line)] sm:grid-cols-3">
              {navigation.map((item) => (
                <Link key={item.href} href={item.href} className="mobile-nav-link">
                  <item.icon size={18} /> {item.label}
                </Link>
              ))}
              <Link href="/igk" className="mobile-nav-link"><Coins size={18} />IGK 지갑</Link>
              <Link href="/igk?tab=ranking" className="mobile-nav-link"><Trophy size={18} />IGK 랭킹</Link>
              <Link href="/igk/roadmap" className="mobile-nav-link"><Trophy size={18} />등급 로드맵</Link>
              <Link href="/notifications" className="mobile-nav-link"><Bell size={18} />알림</Link>
              <Link href="/profile" className="mobile-nav-link"><User size={18} />내 프로필</Link>
            </div> : (
              <div className="grid grid-cols-2 border-t border-[var(--line)]">
                <Link href="/login?returnTo=%2F" className="mobile-nav-link"><User size={18} />로그인</Link>
                <Link href="/register" className="mobile-nav-link"><Users size={18} />회원가입</Link>
                <Link href="/rules" className="mobile-nav-link"><BookOpen size={18} />커뮤니티 규칙</Link>
                <Link href="/privacy" className="mobile-nav-link"><FileText size={18} />개인정보 처리방침</Link>
              </div>
            )}
          </div>
        )}
      </header>

      {sessionError && !isAdmin ? (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-xs text-amber-950" role="status">
          서버 연결이 불안정합니다.
          <button type="button" className="ml-2 font-bold underline underline-offset-2" onClick={() => void refreshSession()}>
            다시 연결
          </button>
        </div>
      ) : null}

      <main inert={mobileOpen || boardPickerOpen} id="main-content" className={isAdmin ? 'min-h-[calc(100vh-120px)]' : 'portal-container min-h-[calc(100vh-220px)] py-4 lg:py-5'}>
        {children}
      </main>

      {!isAdmin && (
        <footer inert={mobileOpen || boardPickerOpen} className="mt-8 border-t border-[var(--line-strong)] bg-white">
          <div className="portal-container grid gap-6 py-6 md:grid-cols-[1.4fr_1fr_1fr]">
            <div>
              <strong>인텍트</strong>
            </div>
            <div className="footer-links">
              <strong>이용 안내</strong>
              {portalNavigationAvailable ? <Link href="/notices">공지사항</Link> : null}
              <Link href="/rules">커뮤니티 규칙</Link>
              <Link href="/privacy">개인정보 처리방침</Link>
            </div>
            <div className="footer-links">
              <strong>도움</strong>
              {portalNavigationAvailable ? <Link href="/support">문의·신고</Link> : null}
              <span>운영: 하태욱</span>
              <a href="tel:01085121201">010-8512-1201</a>
              <a href="mailto:tataboxprotein@gmail.com">tataboxprotein@gmail.com</a>
              <span>© 2026 인텍트</span>
            </div>
          </div>
        </footer>
      )}

      {!isAdmin && portalNavigationAvailable && (
        <div className={`fixed inset-0 z-[70] lg:hidden ${boardPickerOpen ? '' : 'pointer-events-none'}`} aria-hidden={!boardPickerOpen}>
          <button type="button" aria-label="게시판 선택 닫기" onClick={() => setBoardPickerOpen(false)} className={`absolute inset-0 bg-slate-950/45 transition-opacity ${boardPickerOpen ? 'opacity-100' : 'opacity-0'}`} />
          <section id="mobile-board-picker" role="dialog" aria-modal="true" className={`mobile-bottom-sheet absolute inset-x-0 bottom-0 border-t border-slate-300 bg-white px-4 pb-[calc(88px+env(safe-area-inset-bottom))] pt-3 transition-transform duration-200 ${boardPickerOpen ? 'translate-y-0' : 'translate-y-full'}`} aria-label="게시판 선택">
            <div className="mx-auto mb-4 h-1.5 w-10  bg-slate-200" />
            <div className="mb-4 flex items-center justify-between px-1"><h2 className="text-lg font-bold tracking-[-0.03em] text-slate-950">게시판 선택</h2><button type="button" onClick={() => setBoardPickerOpen(false)} className="grid h-11 w-11 place-items-center bg-slate-100 text-slate-600" aria-label="게시판 선택 닫기"><X size={18} /></button></div>
            <div className="grid grid-cols-2 gap-2">
              {boardNavigation.map((item) => <Link key={item.href} href={item.href} className={`flex min-h-[60px] items-center gap-2.5 border p-3 ${pathname.startsWith(item.href) ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-700'}`}><span className="grid h-8 w-8 place-items-center bg-white"><item.icon size={17} /></span><span className="min-w-0 flex-1 text-xs font-semibold">{item.label}</span><ChevronRight size={14} className="text-slate-300" /></Link>)}
            </div>
          </section>
        </div>
      )}

      {!isAdmin && portalNavigationAvailable && (
        <nav inert={mobileOpen || boardPickerOpen} className="mobile-bottom-nav lg:hidden" aria-label="모바일 주요 메뉴">
          <Link href="/" aria-current={pathname === '/' ? 'page' : undefined} className={pathname === '/' ? 'is-active' : ''}><Home size={20} /><span>홈</span></Link>
          <button type="button" onClick={() => setBoardPickerOpen(true)} className={pathname.startsWith('/boards') ? 'is-active' : ''} aria-expanded={boardPickerOpen} aria-controls="mobile-board-picker"><BookOpen size={20} /><span>게시판</span></button>
          <Link href={writeHref}><span className="mobile-compose">+</span><span>글쓰기</span></Link>
          <Link href="/messages" aria-current={pathname.startsWith('/messages') ? 'page' : undefined} className={pathname.startsWith('/messages') ? 'is-active' : ''}><MessageSquare size={20} /><span>대화</span></Link>
          <Link href="/profile" aria-current={pathname.startsWith('/profile') ? 'page' : undefined} className={pathname.startsWith('/profile') ? 'is-active' : ''}><User size={20} /><span>내 정보</span></Link>
        </nav>
      )}
    </div>
  );
}
