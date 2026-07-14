import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { postListSelect } from '@/lib/server/content';
import { ApiError, json, jsonError, paginationMeta, parsePagination } from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await context.params;
    await requireUser(request);
    const board = await prisma.board.findUnique({
      where: { slug },
    });
    if (!board || board.status !== 'ACTIVE') {
      throw new ApiError(404, 'BOARD_NOT_FOUND', '게시판을 찾을 수 없습니다.');
    }

    const url = new URL(request.url);
    const { page, pageSize, skip } = parsePagination(url);
    const sort = url.searchParams.get('sort') ?? 'latest';
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
    const [posts, total] = await prisma.$transaction([
      prisma.post.findMany({ where, orderBy, skip, take: pageSize, select: postListSelect }),
      prisma.post.count({ where }),
    ]);
    return json({ board, posts, pagination: paginationMeta(page, pageSize, total) });
  } catch (error) {
    return jsonError(error);
  }
}
