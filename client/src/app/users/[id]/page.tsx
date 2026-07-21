'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CalendarDays, FileText, Link2, Loader2, MessageCircle, Star, Trophy } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  PageHeading,
  Stat,
  apiErrorMessage,
  readApiEnvelope,
} from '@/components/operations/ui';
import type { IgkStanding } from '@/lib/igk-levels';
import { cosmeticsFromItems } from '@/lib/igk-shop';

type PublicProfile = {
  id: string;
  createdAt: string;
  nickname: string;
  realName: string | null;
  profileImage: string | null;
  bio: string | null;
  interests: string[];
  level: number;
  standing: IgkStanding;
  studentIdentity: { studentCode: string } | null;
  activityStats: { posts: number; comments: number; recommendations: number } | null;
  items: Array<{ itemId: string }>;
};

type PublicPost = {
  id: string;
  title: string;
  contentText: string;
  publishedAt: string | null;
  commentCount: number;
  recommendationCount: number;
  board: { slug: string; name: string };
};

export default function PublicProfilePage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || '');
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [posts, setPosts] = useState<PublicPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return undefined;
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [profileResponse, postsResponse] = await Promise.all([
          fetch(`/api/users/${encodeURIComponent(id)}`, { cache: 'no-store', signal: controller.signal }),
          fetch(`/api/users/${encodeURIComponent(id)}/posts`, { cache: 'no-store', signal: controller.signal }),
        ]);
        const profilePayload = await readApiEnvelope<{ profile: PublicProfile }>(profileResponse);
        const postsPayload = await readApiEnvelope<{ posts: PublicPost[]; nextCursor: string | null }>(postsResponse);
        if (!profileResponse.ok || !profilePayload?.ok) {
          throw new Error(apiErrorMessage(profilePayload, '프로필을 불러오지 못했습니다.'));
        }
        if (!postsResponse.ok || !postsPayload?.ok) {
          throw new Error(apiErrorMessage(postsPayload, '작성 글을 불러오지 못했습니다.'));
        }
        setProfile(profilePayload.data.profile);
        setPosts(postsPayload.data.posts);
        setCursor(postsPayload.data.nextCursor);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '프로필을 불러오지 못했습니다.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [id]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(
        `/api/users/${encodeURIComponent(id)}/posts?cursor=${encodeURIComponent(cursor)}`,
        { cache: 'no-store' },
      );
      const payload = await readApiEnvelope<{ posts: PublicPost[]; nextCursor: string | null }>(response);
      if (!response.ok || !payload?.ok) throw new Error(apiErrorMessage(payload, '작성 글을 더 불러오지 못했습니다.'));
      setPosts((current) => [...current, ...payload.data.posts]);
      setCursor(payload.data.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '작성 글을 더 불러오지 못했습니다.');
    } finally {
      setLoadingMore(false);
    }
  }

  async function shareProfile() {
    if (!profile) return;
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title: `${profile.nickname} 프로필`, url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  }

  if (loading) {
    return (
      <div className="app-page mx-auto w-full max-w-[1000px] px-4 py-5 sm:px-6" role="status" aria-label="프로필을 불러오는 중입니다.">
        <div className="skeleton h-8 w-36" />
        <Card className="mt-4 overflow-hidden">
          <div className="skeleton h-24 rounded-none" />
          <div className="px-5 pb-6 sm:px-7">
            <div className="-mt-10"><div className="skeleton h-20 w-20 rounded-full border-4 border-white" /></div>
            <div className="skeleton mt-4 h-7 w-44" />
            <div className="skeleton mt-2 h-4 w-56" />
            <div className="skeleton mt-5 h-4 w-full max-w-md" />
          </div>
        </Card>
        <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
          <div className="skeleton h-[92px] rounded-2xl" />
          <div className="skeleton h-[92px] rounded-2xl" />
          <div className="skeleton h-[92px] rounded-2xl" />
        </div>
        <Card className="mt-6 p-5">
          <div className="skeleton h-4 w-24" />
          <div className="skeleton mt-3 h-5 w-2/3" />
          <div className="skeleton mt-2 h-4 w-full" />
          <div className="skeleton mt-2 h-4 w-1/2" />
        </Card>
      </div>
    );
  }
  if (!profile) {
    return (
      <div className="app-page mx-auto w-full max-w-[1000px] px-4 py-5 sm:px-6">
        <Card className="anim-fade p-10 text-center text-sm text-slate-600">{error || '프로필을 찾을 수 없습니다.'}</Card>
      </div>
    );
  }
  const cosmetics = cosmeticsFromItems(profile.items);

  return (
    <div className="app-page mx-auto w-full max-w-[1000px] px-4 py-5 sm:px-6">
      <PageHeading
        title="학생 프로필"
        actions={<Button variant="secondary" onClick={() => void shareProfile()}><Link2 className="h-4 w-4" />{copied ? '복사됨' : '공유'}</Button>}
      />
      <Card className="anim-rise mt-4 overflow-hidden">
        <div className={`h-24 bg-[linear-gradient(120deg,#064e3b,#047857_55%,#0f766e)] ${cosmetics?.profileTheme ?? ''}`} />
        <div className="px-5 pb-6 sm:px-7">
          <div className="-mt-10 flex flex-col gap-4 sm:flex-row sm:items-end">
            <Avatar name={profile.nickname} imageUrl={profile.profileImage} size="xl" className={`anim-pop h-20 w-20 border-4 border-white shadow-[var(--shadow-sm)] ${cosmetics?.avatarRing ?? ''}`} />
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-bold tracking-[-0.03em] text-slate-950" style={cosmetics?.nicknameColor ? { color: cosmetics.nicknameColor } : undefined}>{profile.nickname}</h1>
                <Badge tone="green">{profile.standing.tierLabel}</Badge>
                {profile.standing.rankLabel ? <Badge tone="amber">{profile.standing.rankLabel}</Badge> : null}
              </div>
              {cosmetics?.title ? <p className="mt-1.5 text-xs font-bold text-amber-700">{cosmetics.title}</p> : null}
              {profile.realName || profile.studentIdentity?.studentCode ? (
                <p className="mt-1.5 text-sm tabular-nums text-slate-500">{[profile.realName, profile.studentIdentity?.studentCode].filter(Boolean).join(' · ')}</p>
              ) : null}
            </div>
          </div>
          {profile.bio ? <p className="mt-5 max-w-2xl whitespace-pre-wrap text-sm leading-6 text-slate-600">{profile.bio}</p> : null}
          {profile.interests.length ? <div className="mt-4 flex flex-wrap gap-1.5">{profile.interests.map((interest) => <Badge key={interest} tone="slate">#{interest}</Badge>)}</div> : null}
          <p className="mt-5 inline-flex items-center gap-1.5 text-xs text-slate-500"><CalendarDays className="h-3.5 w-3.5 text-slate-400" />{new Date(profile.createdAt).toLocaleDateString('ko-KR')} 가입</p>
        </div>
      </Card>

      {profile.activityStats ? (
        <div className="anim-rise anim-delay-1 mt-4 grid grid-cols-3 gap-2 sm:gap-3">
          {[
            { Icon: FileText, label: '게시글', value: profile.activityStats.posts, tone: 'slate' as const },
            { Icon: MessageCircle, label: '댓글', value: profile.activityStats.comments, tone: 'blue' as const },
            { Icon: Star, label: '받은 추천', value: profile.activityStats.recommendations, tone: 'amber' as const },
          ].map(({ Icon, label, value, tone }) => (
            <Stat key={label} label={label} value={value.toLocaleString()} icon={<Icon className="h-4 w-4" />} tone={tone} />
          ))}
        </div>
      ) : null}

      <section className="anim-rise anim-delay-2 mt-6">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-50 text-emerald-700"><Trophy className="h-4 w-4" /></span>
          <h2 className="text-base font-bold tracking-[-0.02em] text-slate-950">작성한 글</h2>
        </div>
        <Card className="stagger p-2">
          {posts.map((post) => (
            <Link key={post.id} href={`/post/${post.id}`} className={`block rounded-xl px-3 py-3.5 transition-colors duration-200 hover:bg-slate-50/80 ${cosmetics?.postAccent ?? ''}`}>
              <div className="flex items-center gap-2 text-xs text-slate-400"><span className="font-semibold text-slate-500">{post.board.name}</span><span aria-hidden="true">·</span><span>{post.publishedAt ? new Date(post.publishedAt).toLocaleDateString('ko-KR') : ''}</span></div>
              <h3 className="mt-1 truncate text-sm font-bold text-slate-900">{post.title}</h3>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{post.contentText}</p>
              <p className="mt-2 text-xs tabular-nums text-slate-400">댓글 {post.commentCount} · 추천 {post.recommendationCount}</p>
            </Link>
          ))}
          {posts.length === 0 ? <div className="p-10 text-center text-sm text-slate-500">게시 중인 글이 없습니다.</div> : null}
        </Card>
        {cursor ? <Button variant="secondary" className="mt-3 w-full" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}더 보기</Button> : null}
      </section>
      {error ? <div role="alert" className="anim-rise mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    </div>
  );
}
