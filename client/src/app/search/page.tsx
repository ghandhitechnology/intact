import type { Metadata } from 'next';
import SearchClient from '@/components/community/SearchClient';

export const metadata: Metadata = {
  title: '통합검색',
  description: '인텍트의 게시글, 자료, 사용자와 태그를 검색합니다.',
};

type Props = {
  searchParams?: Promise<{ q?: string | string[] }>;
};

export default async function SearchPage({ searchParams }: Props) {
  const resolvedSearchParams = await searchParams;
  const value = resolvedSearchParams?.q;
  const initialQuery = Array.isArray(value) ? value[0] ?? '' : value ?? '';
  return <SearchClient initialQuery={initialQuery} />;
}
