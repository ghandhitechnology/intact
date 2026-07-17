import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { postListSelect, publicAuthorSelect } from '@/lib/server/content';
import { ApiError, json, jsonError, requiredString } from '@/lib/server/http';
import { isSearchSort, rankedPostIds } from '@/lib/server/search';
import { requireUser } from '@/lib/server/session';
import { getPlatformMode, maskPublicIdentitiesWithMode } from '@/lib/server/platform-mode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const platformMode = await getPlatformMode();
    const url = new URL(request.url);
    const query = requiredString(url.searchParams.get('q'), '검색어', { min: 2, max: 100 });
    if (/[%_]{4,}/.test(query)) throw new ApiError(400, 'INVALID_QUERY', '검색어가 올바르지 않습니다.');
    const requestedBoard = url.searchParams.get('board')?.trim() || null;
    if (requestedBoard && (!/^[a-z0-9-]+$/i.test(requestedBoard) || requestedBoard.length > 64)) {
      throw new ApiError(400, 'INVALID_BOARD', '게시판 값이 올바르지 않습니다.');
    }
    const requestedSort = url.searchParams.get('sort');
    const sort = isSearchSort(requestedSort) ? requestedSort : 'relevance';
    const fallbackWhere: Prisma.PostWhereInput = {
      status: 'PUBLISHED',
      publishedAt: { lte: new Date() },
      board: requestedBoard
        ? { slug: requestedBoard, status: 'ACTIVE' }
        : { status: 'ACTIVE' },
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { contentText: { contains: query, mode: 'insensitive' } },
        { tags: { has: query } },
      ],
    };

    const ranked = await rankedPostIds(query, {
      board: requestedBoard,
      sort,
      limit: 30,
    });
    const rankedIds = ranked?.map((item) => item.id) ?? null;
    const postPromise = rankedIds
      ? prisma.post.findMany({
          where: { id: { in: rankedIds } },
          select: postListSelect,
        }).then((rows) => {
          const byId = new Map(rows.map((post) => [post.id, post]));
          return rankedIds.flatMap((id) => {
            const post = byId.get(id);
            return post ? [post] : [];
          });
        })
      : prisma.post.findMany({
          where: fallbackWhere,
          orderBy: sort === 'latest'
            ? [{ publishedAt: 'desc' }, { id: 'desc' }]
            : [{ recommendationCount: 'desc' }, { publishedAt: 'desc' }, { id: 'desc' }],
          take: 30,
          select: postListSelect,
        });

    const userPromise = platformMode.bSideEnabled
      ? prisma.platformAlias.findMany({
          where: {
            epoch: platformMode.bSideEpoch,
            alias: { contains: query, mode: 'insensitive' },
            user: { status: 'ACTIVE', role: { in: ['USER', 'TEACHER'] } },
          },
          orderBy: { alias: 'asc' },
          take: 10,
          select: { user: { select: publicAuthorSelect } },
        }).then((aliases) => aliases.map((entry) => entry.user))
      : prisma.user.findMany({
          where: {
            status: 'ACTIVE',
            role: { in: ['USER', 'TEACHER'] },
            OR: [
              { nickname: { contains: query, mode: 'insensitive' } },
              { realName: { contains: query, mode: 'insensitive' } },
              { studentIdentity: { studentCode: { contains: query } } },
            ],
          },
          take: 10,
          select: publicAuthorSelect,
        });

    const [posts, users] = await Promise.all([postPromise, userPromise]);
    return json({
      query,
      posts: await maskPublicIdentitiesWithMode(posts, session.user.id, platformMode),
      users: await maskPublicIdentitiesWithMode(users, session.user.id, platformMode),
    });
  } catch (error) {
    return jsonError(error);
  }
}
