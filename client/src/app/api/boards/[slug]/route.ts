import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { postListSelect } from '@/lib/server/content';
import {
  cursorBoolean,
  cursorDate,
  cursorNumber,
  cursorScope,
  cursorString,
  decodeCursor,
  encodeCursor,
  type CursorScalar,
} from '@/lib/server/cursor';
import { ApiError, json, jsonError, paginationMeta, parsePagination } from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';
import { maskPublicIdentities } from '@/lib/server/platform-mode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type BoardSort = 'latest' | 'recommended' | 'comments' | 'views';

function normalizedBoardSort(value: string | null): BoardSort {
  return value === 'recommended' || value === 'comments' || value === 'views'
    ? value
    : 'latest';
}

function boardCursorWhere(sort: BoardSort, position: CursorScalar[]): Prisma.PostWhereInput {
  if (position.length !== 3) {
    throw new ApiError(400, 'INVALID_CURSOR', '페이지 커서가 올바르지 않거나 만료되었습니다.');
  }
  const isPinned = cursorBoolean(position[0]!);
  const id = cursorString(position[2]!);
  const pinnedBoundary: Prisma.PostWhereInput[] = isPinned ? [{ isPinned: false }] : [];
  if (sort === 'latest') {
    const publishedAt = cursorDate(position[1]!);
    return { OR: [
      ...pinnedBoundary,
      { isPinned, publishedAt: { lt: publishedAt } },
      { isPinned, publishedAt, id: { lt: id } },
    ] };
  }
  const value = cursorNumber(position[1]!);
  const field = sort === 'recommended'
    ? 'recommendationCount'
    : sort === 'comments'
      ? 'commentCount'
      : 'viewCount';
  return { OR: [
    ...pinnedBoundary,
    { isPinned, [field]: { lt: value } },
    { isPinned, [field]: value, id: { lt: id } },
  ] };
}

function boardCursorPosition(post: {
  id: string;
  isPinned: boolean;
  publishedAt: Date | null;
  recommendationCount: number;
  commentCount: number;
  viewCount: number;
}, sort: BoardSort): CursorScalar[] {
  return [
    post.isPinned,
    sort === 'recommended'
      ? post.recommendationCount
      : sort === 'comments'
        ? post.commentCount
        : sort === 'views'
          ? post.viewCount
          : post.publishedAt?.toISOString() ?? new Date(0).toISOString(),
    post.id,
  ];
}

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await context.params;
    const session = await requireUser(request);
    const board = await prisma.board.findUnique({
      where: { slug },
    });
    if (!board || board.status !== 'ACTIVE') {
      throw new ApiError(404, 'BOARD_NOT_FOUND', '게시판을 찾을 수 없습니다.');
    }

    const url = new URL(request.url);
    const { page, pageSize, skip } = parsePagination(url);
    const sort = normalizedBoardSort(url.searchParams.get('sort'));
    const scope = cursorScope('board-posts', { slug, sort });
    const cursorToken = url.searchParams.get('cursor');
    const cursorWhere = cursorToken
      ? boardCursorWhere(sort, decodeCursor(cursorToken, scope))
      : null;
    const orderBy: Prisma.PostOrderByWithRelationInput[] = [
      { isPinned: 'desc' },
      sort === 'recommended'
        ? { recommendationCount: 'desc' }
        : sort === 'comments'
          ? { commentCount: 'desc' }
          : sort === 'views'
            ? { viewCount: 'desc' }
            : { publishedAt: 'desc' },
      { id: 'desc' },
    ];
    const where: Prisma.PostWhereInput = {
      boardId: board.id,
      status: 'PUBLISHED',
      publishedAt: { lte: new Date() },
    };
    const [postRows, total] = await prisma.$transaction([
      prisma.post.findMany({
        where: cursorWhere ? { AND: [where, cursorWhere] } : where,
        orderBy,
        skip: cursorToken ? 0 : skip,
        take: pageSize + 1,
        select: postListSelect,
      }),
      prisma.post.count({ where }),
    ]);
    const hasMore = postRows.length > pageSize;
    const posts = postRows.slice(0, pageSize);
    const lastPost = posts.at(-1);
    return json({
      board,
      posts: await maskPublicIdentities(posts, session.user.id),
      pagination: {
        ...paginationMeta(page, pageSize, total),
        cursor: cursorToken,
        nextCursor: hasMore && lastPost
          ? encodeCursor(scope, boardCursorPosition(lastPost, sort))
          : null,
        hasMore,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
