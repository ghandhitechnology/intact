import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import PostComposer from '@/components/community/PostComposer';
import { getBoard } from '@/components/community/demo-data';

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const board = getBoard(slug);
  return {
    title: board ? `${board.title} 글쓰기` : '글쓰기',
  };
}

export default async function WritePage({ params }: Props) {
  const { slug } = await params;
  const board = getBoard(slug);
  if (!board) notFound();

  return <PostComposer initialBoard={board} />;
}
