import prisma from '@/lib/prisma';
import { postListSelect, publicAuthorSelect } from '@/lib/server/content';
import { ApiError, json, jsonError, requiredString } from '@/lib/server/http';
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
        where: platformMode.bSideEnabled
          ? { status: 'ACTIVE', role: { in: ['USER', 'TEACHER'] } }
          : {
              status: 'ACTIVE',
              role: { in: ['USER', 'TEACHER'] },
              OR: [
                { nickname: { contains: query, mode: 'insensitive' } },
                { realName: { contains: query, mode: 'insensitive' } },
                { studentIdentity: { studentCode: { contains: query } } },
              ],
            },
        take: platformMode.bSideEnabled ? 1_000 : 10,
        select: publicAuthorSelect,
      }),
    ]);
    const maskedUsers = maskPublicIdentitiesWithMode(users, session.user.id, platformMode);
    const visibleUsers = platformMode.bSideEnabled
      ? maskedUsers.filter((user) =>
          user.id === session.user.id || user.nickname.toLowerCase().includes(query.toLowerCase()),
        ).slice(0, 10)
      : maskedUsers;
    return json({
      query,
      posts: maskPublicIdentitiesWithMode(posts, session.user.id, platformMode),
      users: visibleUsers,
    });
  } catch (error) {
    return jsonError(error);
  }
}
