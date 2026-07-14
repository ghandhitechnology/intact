import prisma from '@/lib/prisma';
import { writeAdminAudit } from '@/lib/server/audit';
import { postListSelect } from '@/lib/server/content';
import { ensureSystemDefaults } from '@/lib/server/defaults';
import { ApiError, assertSameOrigin, json, jsonError, readJson, requiredInteger, requiredString } from '@/lib/server/http';
import { requireReadyAdmin, requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await requireUser(request);
    await ensureSystemDefaults();
    const boards = await prisma.board.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        posts: {
          where: { status: 'PUBLISHED', publishedAt: { lte: new Date() } },
          orderBy: [{ isPinned: 'desc' }, { publishedAt: 'desc' }],
          take: 5,
          select: postListSelect,
        },
        _count: { select: { posts: { where: { status: 'PUBLISHED' } } } },
      },
    });
    const now = new Date();
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

    const boardsWithStats = await Promise.all(boards.map(async (board) => {
      const [todayPosts, todayComments, weeklyPosts, weeklyComments] = await prisma.$transaction([
        prisma.post.count({
          where: {
            boardId: board.id,
            status: 'PUBLISHED',
            publishedAt: { gte: todayStart, lte: now },
          },
        }),
        prisma.comment.count({
          where: {
            status: 'PUBLISHED',
            createdAt: { gte: todayStart, lte: now },
            post: { boardId: board.id, status: 'PUBLISHED' },
          },
        }),
        prisma.post.count({
          where: {
            boardId: board.id,
            status: 'PUBLISHED',
            publishedAt: { gte: weekStart, lte: now },
          },
        }),
        prisma.comment.count({
          where: {
            status: 'PUBLISHED',
            createdAt: { gte: weekStart, lte: now },
            post: { boardId: board.id, status: 'PUBLISHED' },
          },
        }),
      ]);
      return {
        ...board,
        stats: { todayPosts, todayComments, weeklyPosts, weeklyComments },
      };
    }));
    return json({ boards: boardsWithStats });
  } catch (error) {
    return jsonError(error);
  }
}

interface BoardBody {
  slug?: unknown;
  name?: unknown;
  description?: unknown;
  kind?: unknown;
  icon?: unknown;
  accentColor?: unknown;
  sortOrder?: unknown;
  reason?: unknown;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireReadyAdmin(request);
    const body = await readJson<BoardBody>(request);
    const slug = requiredString(body.slug, 'slug', { min: 2, max: 64 }).toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new ApiError(400, 'INVALID_SLUG', 'slug 형식이 올바르지 않습니다.');
    }
    const name = requiredString(body.name, '게시판 이름', { min: 2, max: 80 });
    const description = requiredString(body.description, '게시판 설명', { min: 2, max: 300 });
    const kinds = ['STANDARD', 'QUESTION', 'RECRUITMENT', 'RESOURCE'] as const;
    const kind = kinds.includes(body.kind as (typeof kinds)[number])
      ? (body.kind as (typeof kinds)[number])
      : 'STANDARD';
    const sortOrder = requiredInteger(body.sortOrder ?? 100, '정렬 순서', -10_000, 10_000);
    const reason = requiredString(body.reason, '등록 사유', { min: 2, max: 1_000 });
    const board = await prisma.$transaction(async (tx) => {
      const created = await tx.board.create({
        data: {
          slug,
          name,
          description,
          kind,
          icon: typeof body.icon === 'string' ? body.icon.slice(0, 64) : null,
          accentColor: typeof body.accentColor === 'string' ? body.accentColor.slice(0, 16) : null,
          sortOrder,
          createdById: admin.user.id,
        },
      });
      await writeAdminAudit(tx, request, {
        adminId: admin.user.id,
        action: 'BOARD_CREATE',
        targetType: 'BOARD',
        targetId: created.id,
        reason,
        after: created,
      });
      return created;
    });
    return json({ board }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
