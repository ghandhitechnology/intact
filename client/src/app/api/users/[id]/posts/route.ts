import prisma from '@/lib/prisma';
import { postListSelect } from '@/lib/server/content';
import { ApiError, json, jsonError } from '@/lib/server/http';
import { maskPublicIdentities } from '@/lib/server/platform-mode';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(request);
    const viewerVerified = await prisma.studentIdentity.count({ where: { userId: session.user.id } });
    if (!viewerVerified) throw new ApiError(403, 'STUDENT_ONLY', '인증된 학생만 프로필을 볼 수 있습니다.');
    const { id } = await context.params;
    const exists = await prisma.user.count({ where: { id, status: 'ACTIVE', studentIdentity: { isNot: null } } });
    if (!exists) throw new ApiError(404, 'USER_NOT_FOUND', '프로필을 찾을 수 없습니다.');
    const url = new URL(request.url);
    const cursor = url.searchParams.get('cursor');
    if (cursor && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(cursor)) {
      throw new ApiError(400, 'INVALID_CURSOR', '게시글 위치 정보가 올바르지 않습니다.');
    }
    const rows = await prisma.post.findMany({
      where: { authorId: id, status: 'PUBLISHED' },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: 13,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: postListSelect,
    });
    const hasMore = rows.length > 12;
    const posts = hasMore ? rows.slice(0, 12) : rows;
    return json(await maskPublicIdentities({
      posts,
      nextCursor: hasMore ? posts.at(-1)?.id ?? null : null,
    }, session.user.id));
  } catch (error) {
    return jsonError(error);
  }
}
