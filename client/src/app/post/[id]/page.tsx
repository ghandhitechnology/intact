import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import PostDetailClient from '@/components/community/PostDetailClient';
import {
  adminMember,
  getNotice,
  getPost,
  posts,
  notices,
  type PostSummary,
} from '@/components/community/demo-data';

type Props = {
  params: Promise<{ id: string }>;
};

export const dynamic = 'force-dynamic';

const demoMode = process.env.NEXT_PUBLIC_PORTAL_DEMO_MODE === 'true';

function isBoardSlug(value: unknown): value is PostSummary['board'] {
  return value === 'question' || value === 'contest' || value === 'resources' || value === 'free';
}

const resolveLivePost = cache(async function resolveLivePost(
  id: string,
): Promise<{ post: PostSummary; isNotice: boolean } | null> {
  try {
    const requestHeaders = await headers();
    const internalOrigin = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://127.0.0.1:3000';
    const response = await fetch(`${internalOrigin.replace(/\/$/, '')}/api/posts/${encodeURIComponent(id)}`, {
      headers: { cookie: requestHeaders.get('cookie') || '' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const item = payload?.data?.post || payload?.post;
    if (!item || !isBoardSlug(item?.board?.slug)) return null;
    const sessionResponse = await fetch(`${internalOrigin.replace(/\/$/, '')}/api/auth/session`, {
      headers: { cookie: requestHeaders.get('cookie') || '' },
      cache: 'no-store',
    });
    const sessionPayload = await sessionResponse.json().catch(() => null);
    const sessionUser = sessionPayload?.data?.user || sessionPayload?.user;
    const nickname = item?.author?.realName || item?.author?.nickname || '알 수 없음';
    const metadata = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {};
    return {
      isNotice: false,
      post: {
        id: item.id,
        board: item.board.slug,
        title: item.title,
        excerpt: typeof item.content === 'string' ? item.content.slice(0, 180) : '',
        content: item.content,
        author: {
          nickname,
          studentId: item?.author?.studentIdentity?.studentCode || '------',
          level: Number(item?.author?.level || 1),
          initials: nickname.slice(0, 1),
          profileImage: item?.author?.profileImage || null,
          accent: 'emerald',
        },
        createdAt: new Date(item.publishedAt || item.createdAt).toLocaleString('ko-KR'),
        comments: Number(item.commentCount || 0),
        views: Number(item.viewCount || 0),
        likes: Number(item.recommendationCount || 0),
        tags: Array.isArray(item.tags) ? item.tags : [],
        hot: Number(item.recommendationCount || 0) >= 10,
        solved: Boolean(item.acceptedCommentId || item?.acceptedComment?.id),
        notice: Boolean(item.isPinned),
        attachmentCount: Array.isArray(item.attachments) ? item.attachments.length : 0,
        attachments: Array.isArray(item.attachments) ? item.attachments.map((attachment: any) => ({
          id: String(attachment.id),
          originalName: String(attachment.originalName || '첨부파일'),
          mimeType: String(attachment.mimeType || 'application/octet-stream'),
          sizeBytes: Number(attachment.sizeBytes || 0),
        })) : [],
        viewerRecommended: Boolean(item?.viewerState?.recommended),
        viewerBookmarked: Boolean(item?.viewerState?.bookmarked),
        deadline: typeof metadata.deadline === 'string' ? metadata.deadline : undefined,
        commentItems: Array.isArray(item.comments) ? item.comments.map((comment: any) => {
          const commentNickname = comment?.author?.realName || comment?.author?.nickname || '알 수 없음';
          return {
            id: comment.id,
            parentId: comment.parentId || null,
            author: {
              nickname: commentNickname,
              studentId: comment?.author?.studentIdentity?.studentCode || '------',
              level: Number(comment?.author?.level || 1),
              initials: commentNickname.slice(0, 1),
              profileImage: comment?.author?.profileImage || null,
              accent: 'blue' as const,
            },
            createdAt: new Date(comment.createdAt).toLocaleString('ko-KR'),
            createdAtRaw: new Date(comment.createdAt).getTime(),
            likes: Number(comment.recommendationCount || 0),
            viewerRecommended: Boolean(comment.viewerRecommended),
            accepted: item?.acceptedComment?.id === comment.id,
            content: comment.content,
          };
        }) : [],
        viewer: sessionUser ? {
          nickname: sessionUser.realName || sessionUser.nickname,
          studentId: sessionUser.studentCode || '------',
          level: Number(sessionUser.level || 1),
          initials: String(sessionUser.realName || sessionUser.nickname || '나').slice(0, 1),
          profileImage: sessionUser.profileImage || null,
          accent: 'emerald',
        } : undefined,
      },
    };
  } catch {
    return null;
  }
});

function resolvePost(id: string): { post: PostSummary; isNotice: boolean } | null {
  const post = getPost(id);
  if (post) return { post, isNotice: false };

  const notice = getNotice(id);
  if (!notice) return null;

  return {
    isNotice: true,
    post: {
      id: notice.id,
      board: 'free',
      title: notice.title,
      excerpt: '인텍트 운영팀에서 전하는 중요한 안내입니다.',
      author: adminMember,
      createdAt: `2026.${notice.date}`,
      comments: 0,
      views: 892,
      likes: 74,
      tags: ['공지', '운영안내'],
      notice: true,
    },
  };
}

export function generateStaticParams() {
  if (!demoMode) return [];
  return [...posts.map((post) => ({ id: post.id })), ...notices.map((notice) => ({ id: notice.id }))];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const result = (demoMode ? resolvePost(id) : null) || (await resolveLivePost(id));
  if (!result) return { title: '게시글' };
  return {
    title: result.post.title,
    description: result.post.excerpt,
  };
}

export default async function PostPage({ params }: Props) {
  const { id } = await params;
  const result = (demoMode ? resolvePost(id) : null) || (await resolveLivePost(id));
  if (!result) notFound();

  return <PostDetailClient post={result.post} isNotice={result.isNotice} />;
}
