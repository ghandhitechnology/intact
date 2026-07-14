import prisma from '@/lib/prisma';
import { awardIgk } from '@/lib/server/igk';
import { ApiError, assertSameOrigin, json, jsonError, readJson, requiredString } from '@/lib/server/http';
import { lockResources } from '@/lib/server/locks';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    assertSameOrigin(request);
    const session = await requireUser(request);
    const body = await readJson<{ commentId?: unknown }>(request);
    const commentId = requiredString(body.commentId, 'commentId', { max: 64 });

    const acceptedCommentId = await prisma.$transaction(async (tx) => {
      await lockResources(tx, [`comment:${commentId}`, `post:${id}`]);
      const post = await tx.post.findUnique({
        where: { id },
        select: {
          id: true,
          authorId: true,
          kind: true,
          status: true,
          acceptedCommentId: true,
        },
      });
      if (!post || post.status !== 'PUBLISHED') {
        throw new ApiError(404, 'POST_NOT_FOUND', '게시글을 찾을 수 없습니다.');
      }
      if (post.kind !== 'QUESTION') {
        throw new ApiError(400, 'NOT_A_QUESTION', '질문게시판의 게시글만 답변을 채택할 수 있습니다.');
      }
      if (post.authorId !== session.user.id) {
        throw new ApiError(403, 'NOT_POST_OWNER', '답변을 채택할 권한이 없습니다.');
      }
      const comment = await tx.comment.findUnique({
        where: { id: commentId },
        select: { id: true, postId: true, authorId: true, status: true },
      });
      if (!comment || comment.postId !== post.id || comment.status !== 'PUBLISHED') {
        throw new ApiError(404, 'COMMENT_NOT_FOUND', '채택할 답변을 찾을 수 없습니다.');
      }
      if (post.acceptedCommentId === comment.id) return comment.id;
      if (post.acceptedCommentId) {
        throw new ApiError(
          409,
          'ANSWER_ALREADY_ACCEPTED',
          '이미 채택된 답변은 다른 답변으로 변경할 수 없습니다.',
        );
      }

      await tx.post.update({
        where: { id: post.id },
        data: { acceptedCommentId: comment.id },
      });
      if (comment.authorId !== post.authorId) {
        await awardIgk(tx, {
          userId: comment.authorId,
          counterpartyId: post.authorId,
          amount: 15,
          type: 'ANSWER_ACCEPTED',
          idempotencyKey: `answer:accept:${post.id}:${comment.id}`,
          sourceType: 'COMMENT',
          sourceId: comment.id,
          dailyCap: 150,
          note: '질문 답변 채택 보상',
        });
        await tx.notification.create({
          data: {
            userId: comment.authorId,
            actorId: session.user.id,
            type: 'ANSWER_ACCEPTED',
            title: '작성한 답변이 채택되었습니다.',
            href: `/post/${post.id}#comment-${comment.id}`,
            metadata: { postId: post.id, commentId: comment.id },
          },
        });
      }
      return comment.id;
    });
    return json({ acceptedCommentId });
  } catch (error) {
    return jsonError(error);
  }
}
