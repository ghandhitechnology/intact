import prisma from '@/lib/prisma';
import { writeAdminAudit } from '@/lib/server/audit';
import { reverseReward } from '@/lib/server/igk';
import { lockResources } from '@/lib/server/locks';
import { ApiError, assertSameOrigin, json, jsonError, readJson, requiredString } from '@/lib/server/http';
import { requireReadyAdmin } from '@/lib/server/session';

export const runtime = 'nodejs';

type ContentAction =
  | 'HIDE'
  | 'DELETE'
  | 'RESTORE'
  | 'LOCK'
  | 'UNLOCK'
  | 'PIN'
  | 'UNPIN';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ type: string; id: string }> },
) {
  try {
    const params = await context.params;
    assertSameOrigin(request);
    const admin = await requireReadyAdmin(request);
    const body = await readJson<{ action?: unknown; reason?: unknown }>(request);
    const actions: ContentAction[] = ['HIDE', 'DELETE', 'RESTORE', 'LOCK', 'UNLOCK', 'PIN', 'UNPIN'];
    if (!actions.includes(body.action as ContentAction)) {
      throw new ApiError(400, 'INVALID_ACTION', '지원하지 않는 콘텐츠 관리 작업입니다.');
    }
    const action = body.action as ContentAction;
    const reason = requiredString(body.reason, '처리 사유', { min: 2, max: 1_000 });
    const type = params.type.toUpperCase();
    if (!['POST', 'COMMENT', 'MESSAGE'].includes(type)) {
      throw new ApiError(400, 'INVALID_CONTENT_TYPE', '지원하지 않는 콘텐츠 유형입니다.');
    }

    const result = await prisma.$transaction(async (tx) => {
      let before: unknown;
      let after: unknown;
      if (type === 'POST') {
        await lockResources(tx, [`post:${params.id}`]);
        const post = await tx.post.findUnique({ where: { id: params.id } });
        if (!post) throw new ApiError(404, 'POST_NOT_FOUND', '게시글을 찾을 수 없습니다.');
        before = post;
        if (action === 'HIDE') {
          after = await tx.post.update({ where: { id: post.id }, data: { status: 'HIDDEN' } });
        } else if (action === 'DELETE') {
          const recommendations = await tx.recommendation.findMany({
            where: { postId: post.id },
            select: { id: true },
          });
          after = await tx.post.update({
            where: { id: post.id },
            data: { status: 'DELETED', deletedAt: new Date() },
          });
          await reverseReward(tx, {
            userId: post.authorId,
            originalIdempotencyKey: `post:create:${post.id}`,
            idempotencyKey: `post:admin-delete:${post.id}`,
            sourceType: 'POST',
            sourceId: post.id,
            note: '관리자 삭제에 따른 게시글 보상 회수',
          });
          for (const recommendation of recommendations) {
            await reverseReward(tx, {
              userId: post.authorId,
              originalIdempotencyKey: `recommendation:${recommendation.id}`,
              idempotencyKey: `recommendation:admin-post-delete:${recommendation.id}`,
              sourceType: 'POST',
              sourceId: post.id,
              note: '관리 삭제된 게시글의 추천 보상 회수',
            });
          }
        } else if (action === 'RESTORE') {
          after = await tx.post.update({
            where: { id: post.id },
            data: { status: 'PUBLISHED', deletedAt: null, publishedAt: post.publishedAt ?? new Date() },
          });
        } else if (action === 'LOCK' || action === 'UNLOCK') {
          after = await tx.post.update({
            where: { id: post.id },
            data: { isLocked: action === 'LOCK' },
          });
        } else if (action === 'PIN' || action === 'UNPIN') {
          after = await tx.post.update({
            where: { id: post.id },
            data: { isPinned: action === 'PIN' },
          });
        } else {
          throw new ApiError(400, 'INVALID_ACTION', '게시글에 적용할 수 없는 작업입니다.');
        }
      } else if (type === 'COMMENT') {
        const preliminary = await tx.comment.findUnique({
          where: { id: params.id },
          select: { postId: true },
        });
        if (!preliminary) {
          throw new ApiError(404, 'COMMENT_NOT_FOUND', '댓글을 찾을 수 없습니다.');
        }
        await lockResources(tx, [
          `comment:${params.id}`,
          `post:${preliminary.postId}`,
        ]);
        const comment = await tx.comment.findUnique({
          where: { id: params.id },
          include: { acceptedForPost: { select: { id: true } } },
        });
        if (!comment) throw new ApiError(404, 'COMMENT_NOT_FOUND', '댓글을 찾을 수 없습니다.');
        const recommendations = await tx.recommendation.findMany({
          where: { commentId: comment.id },
          select: { id: true },
        });
        before = comment;
        if (!['HIDE', 'DELETE', 'RESTORE'].includes(action)) {
          throw new ApiError(400, 'INVALID_ACTION', '댓글에 적용할 수 없는 작업입니다.');
        }
        const wasPublished = comment.status === 'PUBLISHED';
        const nextStatus = action === 'HIDE' ? 'HIDDEN' : action === 'DELETE' ? 'DELETED' : 'PUBLISHED';
        after = await tx.comment.update({
          where: { id: comment.id },
          data: { status: nextStatus, deletedAt: action === 'DELETE' ? new Date() : null },
        });
        if (wasPublished && nextStatus !== 'PUBLISHED') {
          await tx.post.update({
            where: { id: comment.postId },
            data: { commentCount: { decrement: 1 } },
          });
        } else if (!wasPublished && nextStatus === 'PUBLISHED') {
          await tx.post.update({
            where: { id: comment.postId },
            data: { commentCount: { increment: 1 } },
          });
        }
        if (action === 'DELETE') {
          await reverseReward(tx, {
            userId: comment.authorId,
            originalIdempotencyKey: `comment:create:${comment.id}`,
            idempotencyKey: `comment:admin-delete:${comment.id}`,
            sourceType: 'COMMENT',
            sourceId: comment.id,
            note: '관리자 삭제에 따른 댓글 보상 회수',
          });
        }
        if (wasPublished && nextStatus !== 'PUBLISHED') {
          for (const recommendation of recommendations) {
            await reverseReward(tx, {
              userId: comment.authorId,
              originalIdempotencyKey: `recommendation:${recommendation.id}`,
              idempotencyKey: `recommendation:admin-comment-remove:${recommendation.id}`,
              sourceType: 'COMMENT',
              sourceId: comment.id,
              note: '관리 조치된 댓글의 추천 보상 회수',
            });
          }
        }
        if ((action === 'HIDE' || action === 'DELETE') && comment.acceptedForPost) {
          await tx.post.update({
            where: { id: comment.acceptedForPost.id },
            data: { acceptedCommentId: null },
          });
          await reverseReward(tx, {
            userId: comment.authorId,
            originalIdempotencyKey: `answer:accept:${comment.acceptedForPost.id}:${comment.id}`,
            idempotencyKey: `answer:admin-remove:${comment.acceptedForPost.id}:${comment.id}`,
            sourceType: 'COMMENT',
            sourceId: comment.id,
            note: '채택 답변 관리 조치에 따른 보상 회수',
          });
        }
      } else {
        const message = await tx.message.findUnique({ where: { id: params.id } });
        if (!message) throw new ApiError(404, 'MESSAGE_NOT_FOUND', '메시지를 찾을 수 없습니다.');
        before = message;
        if (!['DELETE', 'RESTORE'].includes(action)) {
          throw new ApiError(400, 'INVALID_ACTION', '메시지에 적용할 수 없는 작업입니다.');
        }
        after = await tx.message.update({
          where: { id: message.id },
          data: { deletedAt: action === 'DELETE' ? new Date() : null },
        });
      }
      await writeAdminAudit(tx, request, {
        adminId: admin.user.id,
        action: `${type}_${action}`,
        targetType: type,
        targetId: params.id,
        reason,
        before,
        after,
      });
      return after;
    });
    return json({ result });
  } catch (error) {
    return jsonError(error);
  }
}
