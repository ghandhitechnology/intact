import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

export type SearchSort = 'relevance' | 'latest' | 'popular';

export type RankedPost = {
  id: string;
  rank: number;
};

const SEARCH_DATABASE_ERROR_CODES = new Set(['P2010', 'P2021', 'P2022']);

export function isSearchSort(value: string | null): value is SearchSort {
  return value === 'relevance' || value === 'latest' || value === 'popular';
}

export function buildRankedPostSearch(
  query: string,
  options: { board?: string | null; sort?: SearchSort; limit?: number } = {},
) {
  const limit = Math.min(51, Math.max(1, Math.trunc(options.limit ?? 31)));
  const boardFilter = options.board
    ? Prisma.sql`AND b."slug" = ${options.board}`
    : Prisma.empty;
  const orderBy = options.sort === 'latest'
    ? Prisma.sql`r."publishedAt" DESC NULLS LAST, r.rank DESC, r.id DESC`
    : options.sort === 'popular'
      ? Prisma.sql`r."recommendationCount" DESC, r.rank DESC, r."publishedAt" DESC NULLS LAST, r.id DESC`
      : Prisma.sql`r.rank DESC, r."recommendationCount" DESC, r."publishedAt" DESC NULLS LAST, r.id DESC`;

  return Prisma.sql`
    WITH search_input AS (
      SELECT
        websearch_to_tsquery('simple', ${query}) AS tsq,
        ${query}::text AS text_query
    ), ranked AS (
      SELECT
        p.id,
        p."recommendationCount",
        p."publishedAt",
        (
          CASE
            WHEN p."searchVector" @@ input.tsq
            THEN ts_rank_cd(p."searchVector", input.tsq) * 4
            ELSE 0
          END
          + similarity(p.title, input.text_query) * 2
          + similarity(p."contentText", input.text_query)
          + CASE WHEN input.text_query = ANY(p.tags) THEN 2 ELSE 0 END
        )::double precision AS rank
      FROM "Post" p
      JOIN "Board" b ON b.id = p."boardId"
      CROSS JOIN search_input input
      WHERE p.status = 'PUBLISHED'
        AND p."publishedAt" <= CURRENT_TIMESTAMP
        AND b.status = 'ACTIVE'
        ${boardFilter}
        AND (
          p."searchVector" @@ input.tsq
          OR p.title % input.text_query
          OR p.title ILIKE ('%' || input.text_query || '%')
          OR input.text_query = ANY(p.tags)
        )
    )
    SELECT r.id, r.rank
    FROM ranked r
    ORDER BY ${orderBy}
    LIMIT ${limit}
  `;
}

export function isSearchInfrastructureUnavailable(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: unknown }).code) : '';
  if (SEARCH_DATABASE_ERROR_CODES.has(code)) return true;
  const message = error instanceof Error ? error.message : '';
  return /pg_trgm|similarity|tsvector|tsquery|search index/i.test(message);
}

/** Returns null when the search migration/extension is not available yet. */
export async function rankedPostIds(
  query: string,
  options: { board?: string | null; sort?: SearchSort; limit?: number } = {},
): Promise<RankedPost[] | null> {
  try {
    return await prisma.$queryRaw<RankedPost[]>(buildRankedPostSearch(query, options));
  } catch (error) {
    if (isSearchInfrastructureUnavailable(error)) return null;
    throw error;
  }
}
