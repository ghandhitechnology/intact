import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import BoardListClient from '@/components/community/BoardListClient';
import {
  boards,
  getBoard,
  getPostsForBoard,
  type BoardDefinition,
} from '@/components/community/demo-data';

type Props = {
  params: Promise<{ slug: string }>;
};

export const dynamic = 'force-dynamic';

const demoMode = process.env.NEXT_PUBLIC_PORTAL_DEMO_MODE === 'true';

const resolveLiveBoard = cache(async function resolveLiveBoard(
  slug: string,
): Promise<BoardDefinition | null> {
  const presentation = getBoard(slug);
  if (!presentation) return null;
  try {
    const requestHeaders = await headers();
    const internalOrigin = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://127.0.0.1:3000';
    const response = await fetch(`${internalOrigin.replace(/\/$/, '')}/api/boards`, {
      headers: { cookie: requestHeaders.get('cookie') || '' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const liveBoard = (payload?.data?.boards || payload?.boards || []).find(
      (item: { slug?: string }) => item.slug === slug,
    );
    if (!liveBoard) return null;
    return {
      ...presentation,
      title: liveBoard.name || presentation.title,
      shortTitle: liveBoard.name || presentation.shortTitle,
      description: liveBoard.description || presentation.description,
      postCount: Number(liveBoard?._count?.posts || 0),
      todayCount: Number(liveBoard?.stats?.todayPosts || 0),
      todayCommentCount: Number(liveBoard?.stats?.todayComments || 0),
      weeklyPostCount: Number(liveBoard?.stats?.weeklyPosts || 0),
      weeklyCommentCount: Number(liveBoard?.stats?.weeklyComments || 0),
    };
  } catch {
    return null;
  }
});

export function generateStaticParams() {
  return boards.map((board) => ({ slug: board.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const board = (demoMode ? getBoard(slug) : null) || (await resolveLiveBoard(slug));
  if (!board) return { title: '게시판을 찾을 수 없습니다' };

  return {
    title: board.title,
    description: board.description,
  };
}

export default async function BoardPage({ params }: Props) {
  const { slug } = await params;
  const board = (demoMode ? getBoard(slug) : null) || (await resolveLiveBoard(slug));
  if (!board) notFound();

  return (
    <BoardListClient
      board={board}
      initialPosts={demoMode ? getPostsForBoard(board.slug) : []}
    />
  );
}
