import prisma from '@/lib/prisma';
import { commentSelect } from '@/lib/server/content';
import { reverseReward } from '@/lib/server/igk';
import { lockResources } from '@/lib/server/locks';
import {
  ApiError,
  assertSameOrigin,
  json,
  jsonError,
  readJson,
  requiredString,
} from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';
import { maskPublicIdentities } from '@/lib/server/platform-mode';

export const runtime = 'nodejs';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    assertSameOrigin(request);
    const session = await requireUser(request);
    const body = await readJson<{ content?: unknown }>(request, 16_384);
    const content = requiredString(body.content, '댓글', { min: 1, max: 3_000 });
    const old = await prisma.comment.findUnique({ where: { id } });
    if (!old || old.status !== 'PUBLISHED') {
      throw new ApiError(404, 'COMMENT_NOT_FOUND', '댓글을 찾을 수 없습니다.');
    }
    if (old.authorId !== session.user.id) {
      throw new ApiError(403, 'NOT_COMMENT_OWNER', '댓글을 수정할 권한이 없습니다.');
    }
    const comment = await prisma.comment.update({
      where: { id: old.id },
      data: { content, editedAt: new Date() },
      select: commentSelect,
    });
    return json({ comment: await maskPublicIdentities(comment, session.user.id) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    assertSameOrigin(request);
    const session = await requireUser(request);
    const initialComment = await prisma.comment.findUnique({
      where: { id },
      select: { id: true, postId: true, authorId: true, status: true },
    });
    if (!initialComment) throw new ApiError(404, 'COMMENT_NOT_FOUND', '댓글을 찾을 수 없습니다.');
    if (initialComment.authorId !== session.user.id) {
      throw new ApiError(403, 'NOT_COMMENT_OWNER', '댓글을 삭제할 권한이 없습니다.');
    }
    if (initialComment.status === 'DELETED') return json({ deleted: true });

    await prisma.$transaction(async (tx) => {
      await lockResources(tx, [
        `comment:${initialComment.id}`,
        `post:${initialComment.postId}`,
      ]);
      const comment = await tx.comment.findUnique({
        where: { id: initialComment.id },
        include: { acceptedForPost: { select: { id: true } } },
      });
      if (!comment || comment.status === 'DELETED') return;
      const recommendations = await tx.recommendation.findMany({
        where: { commentId: comment.id },
        select: { id: true },
      });
      const deleted = await tx.comment.updateMany({
        where: { id: comment.id, status: comment.status },
        data: { status: 'DELETED', deletedAt: new Date() },
      });
      if (deleted.count === 0) return;
      if (comment.status === 'PUBLISHED') {
        await tx.post.update({
          where: { id: comment.postId },
          data: { commentCount: { decrement: 1 } },
        });
      }
      await reverseReward(tx, {
        userId: comment.authorId,
        originalIdempotencyKey: `comment:create:${comment.id}`,
        idempotencyKey: `comment:delete:${comment.id}`,
        sourceType: 'COMMENT',
        sourceId: comment.id,
        note: '댓글 삭제에 따른 보상 회수',
      });
      for (const recommendation of recommendations) {
        await reverseReward(tx, {
          userId: comment.authorId,
          originalIdempotencyKey: `recommendation:${recommendation.id}`,
          idempotencyKey: `recommendation:comment-delete:${recommendation.id}`,
          sourceType: 'COMMENT',
          sourceId: comment.id,
          note: '삭제된 댓글의 추천 보상 회수',
        });
      }
      if (comment.acceptedForPost) {
        await tx.post.update({
          where: { id: comment.acceptedForPost.id },
          data: { acceptedCommentId: null },
        });
        await reverseReward(tx, {
          userId: comment.authorId,
          originalIdempotencyKey: `answer:accept:${comment.acceptedForPost.id}:${comment.id}`,
          idempotencyKey: `answer:comment-delete:${comment.acceptedForPost.id}:${comment.id}`,
          sourceType: 'COMMENT',
          sourceId: comment.id,
          note: '채택 답변 삭제에 따른 보상 회수',
        });
      }
    });
    return json({ deleted: true });
  } catch (error) {
    return jsonError(error);
  }
}
