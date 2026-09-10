import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { postListSelect } from '@/lib/server/content';
import { ensureSystemDefaults } from '@/lib/server/defaults';
import { maskPublicIdentities } from '@/lib/server/platform-mode';

type BoardReadClient = Pick<Prisma.TransactionClient, 'board' | 'post' | '$queryRaw'>;

export async function loadBoardOverview(client: BoardReadClient = prisma, now = new Date()) {
  const boardsQuery = client.board.findMany({
    where: { status: 'ACTIVE' },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      _count: { select: { posts: { where: { status: 'PUBLISHED' } } } },
    },
  });
  const seoulParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const datePart = (type: 'year' | 'month' | 'day') =>
    seoulParts.find((part) => part.type === type)?.value ?? '';
  const todayStart = new Date(`${datePart('year')}-${datePart('month')}-${datePart('day')}T00:00:00+09:00`);
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000);

  const statsQuery = client.$queryRaw<Array<{
    boardId: string;
    todayPosts: bigint;
    todayComments: bigint;
    weeklyPosts: bigint;
    weeklyComments: bigint;
    postIds: string[];
  }>>`
    WITH post_stats AS (
      SELECT
        "boardId",
        COUNT(*) FILTER (WHERE "publishedAt" >= ${todayStart}) AS "todayPosts",
        COUNT(*) AS "weeklyPosts"
      FROM "Post"
      WHERE status = 'PUBLISHED'
        AND "publishedAt" >= ${weekStart}
        AND "publishedAt" <= ${now}
      GROUP BY "boardId"
    ),
    comment_stats AS (
      SELECT
        p."boardId",
        COUNT(*) FILTER (WHERE c."createdAt" >= ${todayStart}) AS "todayComments",
        COUNT(*) AS "weeklyComments"
      FROM "Comment" c
      INNER JOIN "Post" p ON p.id = c."postId"
      WHERE c.status = 'PUBLISHED'
        AND p.status = 'PUBLISHED'
        AND c."createdAt" >= ${weekStart}
        AND c."createdAt" <= ${now}
      GROUP BY p."boardId"
    )
    SELECT
      b.id AS "boardId",
      COALESCE(ps."todayPosts", 0) AS "todayPosts",
      COALESCE(cs."todayComments", 0) AS "todayComments",
      COALESCE(ps."weeklyPosts", 0) AS "weeklyPosts",
      COALESCE(cs."weeklyComments", 0) AS "weeklyComments",
      ARRAY(
        SELECT p.id
        FROM "Post" p
        WHERE p."boardId" = b.id
          AND p.status = 'PUBLISHED'
          AND p."publishedAt" <= ${now}
        ORDER BY p."isPinned" DESC, p."publishedAt" DESC
        LIMIT 5
      ) AS "postIds"
    FROM "Board" b
    LEFT JOIN post_stats ps ON ps."boardId" = b.id
    LEFT JOIN comment_stats cs ON cs."boardId" = b.id
    WHERE b.status = 'ACTIVE'
  `;
  const [boards, statsRows] = await Promise.all([boardsQuery, statsQuery]);
  // 관계의 take는 Prisma 5에서 전체 게시글을 읽을 수 있어 SQL에서 고른 ID만 조회합니다.
  const postIds = statsRows.flatMap((row) => row.postIds);
  const posts = postIds.length
    ? await client.post.findMany({
      where: { id: { in: postIds }, status: 'PUBLISHED', publishedAt: { lte: now } },
      select: postListSelect,
    })
    : [];
  const postsById = new Map(posts.map((post) => [post.id, post]));
  const statsByBoard = new Map(statsRows.map((row) => [row.boardId, row]));
  const boardsWithStats = boards.map((board) => {
    const row = statsByBoard.get(board.id);
    return {
      ...board,
      posts: (row?.postIds ?? []).flatMap((id) => {
        const post = postsById.get(id);
        return post ? [post] : [];
      }),
      stats: {
        todayPosts: Number(row?.todayPosts ?? 0),
        todayComments: Number(row?.todayComments ?? 0),
        weeklyPosts: Number(row?.weeklyPosts ?? 0),
        weeklyComments: Number(row?.weeklyComments ?? 0),
      },
    };
  });
  return boardsWithStats;
}

export async function readBoardOverview(viewerId: string) {
  await ensureSystemDefaults();
  return { boards: await maskPublicIdentities(await loadBoardOverview(), viewerId) };
}
