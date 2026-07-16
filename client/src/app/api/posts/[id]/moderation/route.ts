import prisma from '@/lib/prisma';
import { ApiError, json, jsonError } from '@/lib/server/http';
import { publicModerationStatus } from '@/lib/server/moderation';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(request);
    const { id } = await context.params;
    const post = await prisma.post.findUnique({ where: { id }, select: { authorId: true } });
    if (!post || (post.authorId !== session.user.id && !['ADMIN', 'DEVELOPER'].includes(session.user.role))) {
      throw new ApiError(404, 'POST_NOT_FOUND', '게시글을 찾을 수 없습니다.');
    }
    const submission = await prisma.moderationSubmission.findFirst({
      where: { postId: id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, state: true, explanationKo: true, createdAt: true, updatedAt: true },
    });
    return json({ moderation: submission ? publicModerationStatus(submission) : null });
  } catch (error) {
    return jsonError(error);
  }
}
