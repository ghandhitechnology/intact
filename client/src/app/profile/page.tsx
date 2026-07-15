'use client';

import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Modal,
  PageHeading,
  Progress,
  Stat,
  Textarea,
  Toast,
  apiErrorMessage,
  readApiEnvelope,
} from '@/components/operations/ui';
import {
  Award,
  CalendarDays,
  Edit3,
  FileText,
  Gift,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  MessageCircle,
  MonitorSmartphone,
  RefreshCw,
  ShieldCheck,
  Trophy,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { igkLevelLabel } from '@/lib/igk-levels';

const DEMO_MODE = process.env.NEXT_PUBLIC_PORTAL_DEMO_MODE === 'true';

type LoadState = 'loading' | 'ready' | 'auth' | 'error';
type SessionLoadState = 'loading' | 'ready' | 'error';
type Profile = {
  id: string;
  createdAt: string;
  nickname: string;
  realName: string | null;
  profileImage: string | null;
  bio: string | null;
  interests: string[];
  role: string;
  status: string;
  currentIgk: number;
  lifetimeIgk: number;
  level: number;
  lastReverifiedAt: string | null;
  reverifyDueAt: string | null;
  studentIdentity: {
    studentCode: string;
    generation: number;
    grade: number;
    classNumber: number;
    studentNumber: number;
    schoolYear: number;
  } | null;
  _count: { posts: number; comments: number; bookmarks: number };
};

type IgkSummary = {
  currentIgk: number;
  lifetimeIgk: number;
  level: number;
  rank: number;
  progress: number;
  nextLevel: { level: number; minimumLifetimeIgk: number; label: string | null } | null;
};

type PortalSession = {
  id: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  current: boolean;
};

type PendingSessionAction =
  | { kind: 'single'; session: PortalSession }
  | { kind: 'others'; count: number }
  | null;

const demoProfile: Profile = {
  id: 'demo-user',
  createdAt: '2025-03-04T00:00:00.000Z',
  nickname: '푸른별',
  realName: '이서연',
  profileImage: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80',
  bio: '물리와 천문을 좋아합니다. 서로 좋은 질문을 주고받아요.',
  interests: ['물리', '천문', '과학대회'],
  role: 'USER',
  status: 'ACTIVE',
  currentIgk: 2480,
  lifetimeIgk: 2980,
  level: 6,
  lastReverifiedAt: '2026-03-04T00:00:00.000Z',
  reverifyDueAt: '2027-03-04T00:00:00.000Z',
  studentIdentity: { studentCode: '331201', generation: 33, grade: 1, classNumber: 2, studentNumber: 1, schoolYear: 2026 },
  _count: { posts: 24, comments: 138, bookmarks: 17 },
};

const demoIgk: IgkSummary = {
  currentIgk: 2480,
  lifetimeIgk: 2980,
  level: 6,
  rank: 18,
  progress: (2980 - 2000) / (3500 - 2000),
  nextLevel: { level: 7, minimumLifetimeIgk: 3500, label: '3등급' },
};

const demoSessions: PortalSession[] = [
  {
    id: 'demo-current-session',
    createdAt: '2026-07-12T08:20:00.000Z',
    lastSeenAt: '2026-07-12T08:50:00.000Z',
    expiresAt: '2026-08-11T08:20:00.000Z',
    userAgent: 'Safari on macOS · 시연용 현재 기기',
    current: true,
  },
  {
    id: 'demo-other-session',
    createdAt: '2026-07-10T11:10:00.000Z',
    lastSeenAt: '2026-07-11T14:05:00.000Z',
    expiresAt: '2026-08-09T11:10:00.000Z',
    userAgent: 'Chrome on Windows · 시연용 다른 기기',
    current: false,
  },
];

const dateFormatter = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
const dateTimeFormatter = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dateFormatter.format(date);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '시간 정보 없음';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '시간 정보 없음' : dateTimeFormatter.format(date);
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(DEMO_MODE ? demoProfile : null);
  const [igk, setIgk] = useState<IgkSummary | null>(DEMO_MODE ? demoIgk : null);
  const [loadState, setLoadState] = useState<LoadState>(DEMO_MODE ? 'ready' : 'loading');
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [draftNickname, setDraftNickname] = useState(DEMO_MODE ? demoProfile.nickname : '');
  const [draftProfileImage, setDraftProfileImage] = useState(DEMO_MODE ? demoProfile.profileImage ?? '' : '');
  const [draftBio, setDraftBio] = useState(DEMO_MODE ? demoProfile.bio ?? '' : '');
  const [interestDraft, setInterestDraft] = useState(DEMO_MODE ? demoProfile.interests.join(', ') : '');
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<'success' | 'error'>('success');
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [sessions, setSessions] = useState<PortalSession[]>(DEMO_MODE ? demoSessions : []);
  const [sessionLoadState, setSessionLoadState] = useState<SessionLoadState>(DEMO_MODE ? 'ready' : 'loading');
  const [sessionError, setSessionError] = useState('');
  const [sessionReloadKey, setSessionReloadKey] = useState(0);
  const [pendingSessionAction, setPendingSessionAction] = useState<PendingSessionAction>(null);
  const [revokingSessions, setRevokingSessions] = useState(false);

  useEffect(() => {
    if (DEMO_MODE) return undefined;
    const controller = new AbortController();
    let active = true;

    async function load() {
      setLoadState('loading');
      setLoadError('');
      try {
        const [profileResponse, igkResponse] = await Promise.all([
          fetch('/api/profile', { cache: 'no-store', signal: controller.signal }),
          fetch('/api/igk/balance', { cache: 'no-store', signal: controller.signal }),
        ]);
        const profilePayload = await readApiEnvelope<{ profile: Profile }>(profileResponse);
        const igkPayload = await readApiEnvelope<IgkSummary>(igkResponse);
        if (!active) return;
        if (profileResponse.status === 401 || igkResponse.status === 401) {
          setLoadState('auth');
          return;
        }
        if (!profileResponse.ok || !profilePayload?.ok) {
          throw new Error(apiErrorMessage(profilePayload, '프로필을 불러오지 못했습니다.'));
        }
        const nextProfile = profilePayload.data.profile;
        setProfile(nextProfile);
        setDraftNickname(nextProfile.nickname);
        setDraftProfileImage(nextProfile.profileImage ?? '');
        setDraftBio(nextProfile.bio ?? '');
        setInterestDraft(nextProfile.interests.join(', '));
        setIgk(igkResponse.ok && igkPayload?.ok ? igkPayload.data : null);
        setLoadState('ready');
      } catch (cause) {
        if (!active || controller.signal.aborted) return;
        setLoadError(cause instanceof Error ? cause.message : '프로필을 불러오지 못했습니다.');
        setLoadState('error');
      }
    }

    void load();
    return () => { active = false; controller.abort(); };
  }, [reloadKey]);

  useEffect(() => {
    if (DEMO_MODE) return undefined;
    const controller = new AbortController();
    let active = true;

    async function loadSessions() {
      setSessionLoadState('loading');
      setSessionError('');
      try {
        const response = await fetch('/api/auth/sessions', {
          cache: 'no-store',
          signal: controller.signal,
        });
        const payload = await readApiEnvelope<{ sessions: PortalSession[] }>(response);
        if (!active) return;
        if (response.status === 401) {
          setLoadState('auth');
          return;
        }
        if (!response.ok || !payload?.ok) {
          throw new Error(apiErrorMessage(payload, '활성 로그인을 불러오지 못했습니다.'));
        }
        setSessions(payload.data.sessions);
        setSessionLoadState('ready');
      } catch (cause) {
        if (!active || controller.signal.aborted) return;
        setSessionError(cause instanceof Error ? cause.message : '활성 로그인을 불러오지 못했습니다.');
        setSessionLoadState('error');
      }
    }

    void loadSessions();
    return () => { active = false; controller.abort(); };
  }, [sessionReloadKey]);

  function openEditor() {
    if (!profile) return;
    setDraftNickname(profile.nickname);
    setDraftProfileImage(profile.profileImage ?? '');
    setDraftBio(profile.bio ?? '');
    setInterestDraft(profile.interests.join(', '));
    setEditOpen(true);
  }

  async function saveProfile() {
    if (!profile || !/^[\p{L}\p{N}_-]{2,16}$/u.test(draftNickname)) return;
    const interests = Array.from(new Set(interestDraft.split(',').map((value) => value.trim()).filter(Boolean))).slice(0, 5);
    setSaving(true);
    try {
      if (DEMO_MODE) {
        setProfile({ ...profile, nickname: draftNickname, profileImage: draftProfileImage.trim() || null, bio: draftBio.trim() || null, interests });
      } else {
        const response = await fetch('/api/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nickname: draftNickname, profileImage: draftProfileImage, bio: draftBio, interests }),
        });
        const payload = await readApiEnvelope<{ profile: Pick<Profile, 'id' | 'nickname' | 'profileImage' | 'bio' | 'interests' | 'level'> }>(response);
        if (response.status === 401) {
          setEditOpen(false);
          setLoadState('auth');
          return;
        }
        if (!response.ok || !payload?.ok) throw new Error(apiErrorMessage(payload, '프로필을 저장하지 못했습니다.'));
        setProfile({ ...profile, ...payload.data.profile });
      }
      setEditOpen(false);
      setToastTone('success');
      setToast('프로필을 저장했습니다.');
    } catch (cause) {
      setToastTone('error');
      setToast(cause instanceof Error ? cause.message : '프로필을 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError('');
    if (DEMO_MODE) {
      setPasswordError('시연 모드에서는 비밀번호를 변경하거나 입력한 값을 전송하지 않습니다.');
      return;
    }
    if (!currentPassword) {
      setPasswordError('현재 비밀번호를 입력해 주세요.');
      return;
    }
    if (newPassword.length < 10 || newPassword.length > 128) {
      setPasswordError('새 비밀번호는 10자 이상 128자 이하여야 합니다.');
      return;
    }
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setPasswordError('새 비밀번호에 영문자와 숫자를 모두 포함해 주세요.');
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError('현재 비밀번호와 다른 비밀번호를 사용해 주세요.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('새 비밀번호 확인이 일치하지 않습니다.');
      return;
    }

    setChangingPassword(true);
    try {
      const response = await fetch('/api/auth/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const payload = await readApiEnvelope<{ changed: boolean }>(response);
      const errorCode = payload && !payload.ok ? payload.error.code : null;
      if (response.status === 401 && errorCode !== 'INVALID_PASSWORD') {
        setLoadState('auth');
        return;
      }
      if (!response.ok || !payload?.ok) {
        throw new Error(apiErrorMessage(payload, '비밀번호를 변경하지 못했습니다.'));
      }
      if (!payload.data.changed) throw new Error('비밀번호 변경이 완료되지 않았습니다.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setToastTone('success');
      setToast('비밀번호를 변경하고 현재 세션을 제외한 기존 로그인을 종료했습니다.');
      setSessionReloadKey((value) => value + 1);
    } catch (cause) {
      setPasswordError(cause instanceof Error ? cause.message : '비밀번호를 변경하지 못했습니다.');
    } finally {
      setChangingPassword(false);
    }
  }

  async function revokeSelectedSessions() {
    if (!pendingSessionAction || DEMO_MODE) return;
    setRevokingSessions(true);
    setSessionError('');
    try {
      const response = await fetch('/api/auth/sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          pendingSessionAction.kind === 'others'
            ? { allOthers: true }
            : { sessionId: pendingSessionAction.session.id },
        ),
      });
      const payload = await readApiEnvelope<{ revokedSessions: number }>(response);
      if (response.status === 401) {
        setPendingSessionAction(null);
        setLoadState('auth');
        return;
      }
      if (!response.ok || !payload?.ok) {
        throw new Error(apiErrorMessage(payload, '로그인 세션을 종료하지 못했습니다.'));
      }

      const revokedCount = payload.data.revokedSessions;
      const endedCurrent = pendingSessionAction.kind === 'single'
        && pendingSessionAction.session.current;
      if (endedCurrent) {
        setPendingSessionAction(null);
        setLoadState('auth');
        router.replace('/login');
        router.refresh();
        return;
      }

      if (pendingSessionAction.kind === 'others') {
        setSessions((current) => current.filter((session) => session.current));
      } else {
        const endedId = pendingSessionAction.session.id;
        setSessions((current) => current.filter((session) => session.id !== endedId));
      }
      setPendingSessionAction(null);
      setToastTone('success');
      setToast(
        revokedCount > 0
          ? `${revokedCount}개의 포털 로그인을 종료했습니다.`
          : '이미 종료된 로그인입니다. 목록을 새로고침합니다.',
      );
      setSessionReloadKey((value) => value + 1);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '로그인 세션을 종료하지 못했습니다.';
      setSessionError(message);
      setToastTone('error');
      setToast(message);
    } finally {
      setRevokingSessions(false);
    }
  }

  if (loadState !== 'ready' || !profile) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6 lg:px-8">
        <PageHeading title="내 프로필" />
        <Card className="mt-4 p-8 text-center">
          {loadState === 'loading' ? <><Loader2 className="mx-auto h-7 w-7 animate-spin text-blue-700" /><h2 className="mt-4 text-sm font-extrabold text-slate-900">프로필을 불러오는 중입니다.</h2></> : null}
          {loadState === 'auth' ? <><LogIn className="mx-auto h-7 w-7 text-blue-700" /><h2 className="mt-4 text-sm font-extrabold text-slate-900">로그인이 필요합니다.</h2><Link href="/login" className="mt-5 inline-flex h-10 items-center bg-blue-700 px-4 text-sm font-bold text-white">로그인하기</Link></> : null}
          {loadState === 'error' ? <><RefreshCw className="mx-auto h-7 w-7 text-red-600" /><h2 className="mt-4 text-sm font-extrabold text-slate-900">프로필을 표시할 수 없습니다.</h2><p className="mt-2 text-xs text-red-600">{loadError}</p><Button className="mt-5" onClick={() => setReloadKey((value) => value + 1)}><RefreshCw className="h-4 w-4" />다시 시도</Button></> : null}
        </Card>
      </div>
    );
  }

  const identity = profile.studentIdentity;
  const identityLine = identity ? `${identity.studentCode} · ${identity.generation}기 · ${identity.grade}학년 ${identity.classNumber}반 ${identity.studentNumber}번` : '학생 인증 정보 없음';
  const currentIgk = igk?.currentIgk ?? profile.currentIgk;
  const lifetimeIgk = igk?.lifetimeIgk ?? profile.lifetimeIgk;
  const level = igk?.level ?? profile.level;
  const nextThreshold = igk?.nextLevel?.minimumLifetimeIgk ?? null;
  const progress = igk ? Math.round(igk.progress * 1000) / 10 : 100;
  const otherSessionCount = sessions.filter((session) => !session.current).length;

  return (
    <div className="mx-auto w-full max-w-[1540px] px-4 py-4 sm:px-6 lg:px-8">
      <PageHeading title="내 프로필" actions={<Button variant="secondary" onClick={openEditor}><Edit3 className="h-4 w-4" />프로필 편집</Button>} />

      <div className="mt-4 grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_280px]">
        <aside className="space-y-4">
          <Card className="overflow-hidden ">
            <div className="h-1 bg-emerald-700" />
            <div className="p-4">
              <div className="flex items-end justify-between"><Avatar name={profile.realName || profile.nickname} imageUrl={profile.profileImage} size="xl" tone="blue" /><Badge tone={profile.status === 'ACTIVE' ? 'green' : 'amber'} className="mb-1"><ShieldCheck className="mr-1 h-3 w-3" />{profile.status === 'ACTIVE' ? '재학생 인증' : profile.status}</Badge></div>
              <h2 className="mt-4 text-xl font-black tracking-[-0.035em] text-slate-950">{profile.realName || profile.nickname}</h2>
              <p className="mt-1 text-xs font-bold text-slate-500">{identityLine}</p>
              <p className="mt-4 text-sm leading-6 text-slate-600">{profile.bio || '아직 소개가 없습니다.'}</p>
              {profile.interests.length ? <div className="mt-4 flex flex-wrap gap-1.5">{profile.interests.map((interest) => <Badge key={interest} tone="slate">#{interest}</Badge>)}</div> : null}
              <div className="mt-4 border-t border-slate-200 pt-3 text-xs text-slate-500"><div className="flex items-center gap-2"><CalendarDays className="h-3.5 w-3.5" />{formatDate(profile.createdAt) ?? '날짜 정보 없음'} 가입</div>{profile.lastReverifiedAt ? <div className="mt-2 flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5" />{formatDate(profile.lastReverifiedAt)} 재인증</div> : null}</div>
            </div>
          </Card>
          <Card className=""><CardHeader title="활동 통계" /><div className="grid grid-cols-2 gap-px bg-slate-200">{[['게시글', profile._count.posts], ['댓글', profile._count.comments], ['스크랩', profile._count.bookmarks], ['누적 IGK', lifetimeIgk]].map(([label, value]) => <div key={String(label)} className="bg-white p-4 text-center"><strong className="block text-xl font-black text-slate-950">{Number(value).toLocaleString()}</strong><span className="mt-1 block text-[11px] font-medium text-slate-500">{label}</span></div>)}</div></Card>
        </aside>

        <section className="min-w-0 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="현재 등급" value={igkLevelLabel(level)} detail="활동·받은 선물 누적" icon={<Trophy className="h-4 w-4" />} tone="amber" />
            <Stat label="보유 IGK" value={currentIgk.toLocaleString()} detail={`누적 ${lifetimeIgk.toLocaleString()}`} icon={<Gift className="h-4 w-4" />} tone="green" />
            <Stat label="작성한 글" value={profile._count.posts.toLocaleString()} detail="전체 게시판" icon={<Award className="h-4 w-4" />} />
            <Stat label="교내 랭킹" value={igk ? `#${igk.rank}` : '—'} detail={igk ? '보유 IGK 기준' : '랭킹 정보 없음'} icon={<Users className="h-4 w-4" />} tone="slate" />
          </div>
          <Card className=""><CardHeader title="활동 요약" /><div className="grid gap-px bg-slate-200 sm:grid-cols-3"><div className="bg-white p-4"><FileText className="h-5 w-5 text-blue-700" /><strong className="mt-2 block text-xl font-black">{profile._count.posts.toLocaleString()}</strong><span className="text-xs text-slate-500">작성한 게시글</span></div><div className="bg-white p-4"><MessageCircle className="h-5 w-5 text-emerald-700" /><strong className="mt-2 block text-xl font-black">{profile._count.comments.toLocaleString()}</strong><span className="text-xs text-slate-500">작성한 댓글</span></div><div className="bg-white p-4"><Award className="h-5 w-5 text-amber-700" /><strong className="mt-2 block text-xl font-black">{profile._count.bookmarks.toLocaleString()}</strong><span className="text-xs text-slate-500">저장한 글</span></div></div></Card>
        </section>

        <aside className="space-y-4 lg:col-span-2 xl:col-span-1">
          <Card className=""><CardHeader title="등급 진행" action={<Link href="/igk/roadmap" className="text-xs font-bold text-blue-700">전체 로드맵</Link>} /><div className="p-5"><div className="flex items-end justify-between"><div><span className="text-xs font-bold text-slate-500">현재 {igkLevelLabel(level)}</span><p className="mt-1 text-lg font-black text-slate-950">{nextThreshold ? `다음 ${igk?.nextLevel?.label ?? igkLevelLabel(igk?.nextLevel?.level ?? level + 1)}` : '최고 등급 선생님'}</p></div>{nextThreshold ? <span className="text-xs font-bold text-blue-700">{lifetimeIgk.toLocaleString()} / {nextThreshold.toLocaleString()}</span> : null}</div><div className="mt-4"><Progress value={progress} /></div><p className="mt-3 text-xs leading-5 text-slate-500">{nextThreshold ? <>다음 등급까지 <strong className="text-slate-800">{Math.max(0, nextThreshold - lifetimeIgk).toLocaleString()} IGK</strong>가 필요합니다.</> : '최종 등급에 도달했습니다.'}</p><Link href="/igk/roadmap" className="mt-5 flex h-10 w-full items-center justify-center border border-slate-300 text-xs font-extrabold text-slate-700 hover:bg-slate-50">9등급부터 선생님까지 보기</Link></div></Card>
          <Card className=""><CardHeader title="재학생 인증" /><div className="p-5"><p className="flex items-center gap-2 text-sm font-extrabold text-slate-900"><ShieldCheck className="h-4 w-4 text-emerald-700" />{profile.status === 'ACTIVE' ? '정상 이용 가능' : profile.status}</p><p className="mt-2 text-xs leading-5 text-slate-500">{profile.reverifyDueAt ? `${formatDate(profile.reverifyDueAt)}까지 재인증이 유효합니다.` : '재인증 만료일이 등록되지 않았습니다.'}</p></div></Card>
        </aside>
      </div>

      <section className="mt-6" aria-labelledby="account-security-title">
        <div className="mb-3 border-b border-slate-200 pb-3">
          <h2 id="account-security-title" className="text-lg font-black tracking-[-0.03em] text-slate-950">계정 보안</h2>
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Card className="">
            <CardHeader
              title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-blue-700" />비밀번호 변경</span>}
              description="변경하면 현재 세션을 제외한 기존 로그인이 자동으로 종료됩니다."
            />
            <form onSubmit={changePassword} className="space-y-4 p-5" noValidate>
              {DEMO_MODE && (
                <div className="border border-amber-300 bg-white px-4 py-3 text-xs leading-5 text-amber-800">
                  시연 모드입니다. 비밀번호를 입력하거나 서버에 변경을 전송할 수 없습니다.
                </div>
              )}
              <Field label="현재 비밀번호" required>
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  maxLength={128}
                  disabled={DEMO_MODE || changingPassword}
                />
              </Field>
              <Field label="새 비밀번호" required hint="10~128자, 영문자·숫자 포함">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  minLength={10}
                  maxLength={128}
                  disabled={DEMO_MODE || changingPassword}
                />
              </Field>
              <Field label="새 비밀번호 확인" required>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  minLength={10}
                  maxLength={128}
                  disabled={DEMO_MODE || changingPassword}
                />
              </Field>
              {passwordError && (
                <div role="alert" className="border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium leading-5 text-red-700">
                  {passwordError}
                </div>
              )}
              <div className="flex justify-end border-t border-slate-100 pt-4">
                <Button type="submit" disabled={DEMO_MODE || changingPassword}>
                  {changingPassword ? <><Loader2 className="h-4 w-4 animate-spin" />변경 중…</> : <><KeyRound className="h-4 w-4" />비밀번호 변경</>}
                </Button>
              </div>
            </form>
          </Card>

          <Card className="">
            <CardHeader
              title={<span className="flex items-center gap-2"><MonitorSmartphone className="h-4 w-4 text-emerald-700" />활성 포털 로그인</span>}
              action={DEMO_MODE
                ? <Badge tone="amber">시연 데이터</Badge>
                : <Button
                    type="button"
                    variant="ghost"
                    className="h-8 px-2.5 text-xs"
                    onClick={() => setSessionReloadKey((value) => value + 1)}
                    disabled={sessionLoadState === 'loading' || revokingSessions}
                  >
                    <RefreshCw className={sessionLoadState === 'loading' ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
                    새로고침
                  </Button>}
            />

            {sessionLoadState === 'loading' && (
              <div className="flex min-h-48 flex-col items-center justify-center p-6 text-center">
                <Loader2 className="h-6 w-6 animate-spin text-blue-700" />
                <p className="mt-3 text-xs font-bold text-slate-500">활성 로그인을 확인하는 중…</p>
              </div>
            )}

            {sessionLoadState === 'error' && (
              <div className="p-5">
                <div role="alert" className="border border-red-200 bg-red-50 px-4 py-4 text-xs leading-5 text-red-700">{sessionError}</div>
                <Button type="button" variant="secondary" className="mt-4 w-full" onClick={() => setSessionReloadKey((value) => value + 1)}>
                  <RefreshCw className="h-4 w-4" />다시 불러오기
                </Button>
              </div>
            )}

            {sessionLoadState === 'ready' && (
              <>
                {sessionError && (
                  <div role="alert" className="m-4 mb-0 border border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-700">
                    {sessionError}
                  </div>
                )}
                <div className="divide-y divide-slate-100">
                  {sessions.map((session) => (
                    <article key={session.id} className="p-5">
                      <div className="flex items-start gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center bg-slate-100 text-slate-600">
                          <MonitorSmartphone className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-extrabold text-slate-900">{session.current ? '현재 사용 중인 세션' : '다른 포털 세션'}</h3>
                            {session.current && <Badge tone="green">현재 세션</Badge>}
                          </div>
                          <p className="mt-1 line-clamp-2 break-all text-[11px] leading-5 text-slate-500" title={session.userAgent || undefined}>
                            {session.userAgent || '브라우저 정보가 제공되지 않았습니다.'}
                          </p>
                          <dl className="mt-3 grid gap-1 text-[11px] leading-5 text-slate-500 sm:grid-cols-2">
                            <div><dt className="inline font-bold text-slate-600">최근 확인 </dt><dd className="inline">{formatDateTime(session.lastSeenAt)}</dd></div>
                            <div><dt className="inline font-bold text-slate-600">자동 만료 </dt><dd className="inline">{formatDateTime(session.expiresAt)}</dd></div>
                            <div className="sm:col-span-2"><dt className="inline font-bold text-slate-600">로그인 시작 </dt><dd className="inline">{formatDateTime(session.createdAt)}</dd></div>
                          </dl>
                        </div>
                      </div>
                      <div className="mt-4 flex justify-end">
                        <Button
                          type="button"
                          variant="danger"
                          className="h-9 px-3 text-xs"
                          disabled={DEMO_MODE || revokingSessions}
                          onClick={() => setPendingSessionAction({ kind: 'single', session })}
                        >
                          <LogOut className="h-3.5 w-3.5" />
                          {session.current ? '현재 로그인 종료' : '이 로그인 종료'}
                        </Button>
                      </div>
                    </article>
                  ))}
                  {sessions.length === 0 && (
                    <div className="px-5 py-12 text-center text-xs leading-5 text-slate-400">표시할 활성 포털 세션이 없습니다.</div>
                  )}
                </div>
                <div className="border-t border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[11px] leading-5 text-slate-500">최근 확인 시간은 서버에서 최대 15분 단위로 갱신됩니다.</p>
                    <Button
                      type="button"
                      variant="danger"
                      className="h-9 px-3 text-xs"
                      disabled={DEMO_MODE || otherSessionCount === 0 || revokingSessions}
                      onClick={() => setPendingSessionAction({ kind: 'others', count: otherSessionCount })}
                    >
                      <LogOut className="h-3.5 w-3.5" />다른 로그인 모두 종료
                    </Button>
                  </div>
                </div>
              </>
            )}
          </Card>
        </div>
      </section>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="프로필 편집" description="학번과 학적은 재학생 인증 정보이므로 변경하거나 숨길 수 없습니다." footer={<><Button variant="secondary" onClick={() => setEditOpen(false)}>취소</Button><Button onClick={() => void saveProfile()} disabled={saving}>{saving ? '저장 중…' : '변경사항 저장'}</Button></>}>
        <form onSubmit={(event) => { event.preventDefault(); void saveProfile(); }} className="space-y-5"><div className="flex items-center gap-4 border border-slate-200 bg-slate-50 p-4"><Avatar name={profile.realName || profile.nickname} imageUrl={draftProfileImage || null} size="lg" tone="blue" /><div><p className="text-sm font-black text-slate-900">{profile.realName || profile.nickname}</p><p className="text-xs text-slate-500">인증된 실명</p></div></div><Field label="프로필 이미지 주소" hint="HTTPS 이미지"><Input type="url" value={draftProfileImage} onChange={(event) => setDraftProfileImage(event.target.value)} maxLength={2048} placeholder="https://example.com/profile.jpg" /></Field><Field label="소개" hint={`${draftBio.length}/280`}><Textarea rows={4} value={draftBio} onChange={(event) => setDraftBio(event.target.value)} maxLength={280} /></Field><Field label="관심 분야" hint="쉼표로 구분, 최대 5개"><Input value={interestDraft} onChange={(event) => setInterestDraft(event.target.value)} placeholder="물리, 천문, 과학대회" /></Field><div className="border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-bold text-slate-700">인증 정보</p><p className="mt-2 text-sm text-slate-900">{identityLine}</p><p className="mt-1 text-[11px] leading-5 text-slate-500">게시글과 댓글에는 인증된 실명과 학번이 표시됩니다.</p></div><button type="submit" className="hidden">저장</button></form>
      </Modal>
      <Modal
        open={Boolean(pendingSessionAction)}
        onClose={() => { if (!revokingSessions) setPendingSessionAction(null); }}
        title={pendingSessionAction?.kind === 'others' ? '다른 로그인 모두 종료' : '포털 로그인 종료'}
        description="세션을 종료하면 해당 브라우저에서 다시 로그인해야 합니다."
        footer={<>
          <Button type="button" variant="secondary" onClick={() => setPendingSessionAction(null)} disabled={revokingSessions}>취소</Button>
          <Button type="button" variant="danger" onClick={() => void revokeSelectedSessions()} disabled={revokingSessions}>
            {revokingSessions ? <><Loader2 className="h-4 w-4 animate-spin" />종료 중…</> : <><LogOut className="h-4 w-4" />로그인 종료</>}
          </Button>
        </>}
      >
        <div className="border border-amber-300 bg-white p-4 text-sm leading-6 text-amber-900">
          {pendingSessionAction?.kind === 'others'
            ? `현재 세션은 유지하고 다른 활성 로그인 ${pendingSessionAction.count}개를 종료합니다.`
            : pendingSessionAction?.session.current
              ? '현재 사용 중인 세션입니다. 종료하면 즉시 로그아웃됩니다.'
              : '선택한 다른 포털 로그인을 종료합니다.'}
        </div>
      </Modal>
      <Toast message={toast} tone={toastTone} onClose={() => setToast(null)} />
    </div>
  );
}
