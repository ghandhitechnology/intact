import prisma from '@/lib/prisma';
import { postListSelect, publicAuthorSelect } from '@/lib/server/content';
import { ApiError, json, jsonError, requiredString } from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await requireUser(request);
    const url = new URL(request.url);
    const query = requiredString(url.searchParams.get('q'), '검색어', { min: 2, max: 100 });
    if (/[%_]{4,}/.test(query)) throw new ApiError(400, 'INVALID_QUERY', '검색어가 올바르지 않습니다.');
    const [posts, users] = await prisma.$transaction([
      prisma.post.findMany({
        where: {
          status: 'PUBLISHED',
          board: { status: 'ACTIVE' },
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { contentText: { contains: query, mode: 'insensitive' } },
            { tags: { has: query } },
          ],
        },
        orderBy: [{ recommendationCount: 'desc' }, { publishedAt: 'desc' }],
        take: 30,
        select: postListSelect,
      }),
      prisma.user.findMany({
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
      }),
    ]);
    return json({ query, posts, users });
  } catch (error) {
    return jsonError(error);
  }
}
