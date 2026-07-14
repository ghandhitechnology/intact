import prisma from '@/lib/prisma';
import { awardIgk, reverseReward } from '@/lib/server/igk';
import { lockResources } from '@/lib/server/locks';
import {
  ApiError,
  assertSameOrigin,
  enforceRateLimit,
  isUniqueConstraintError,
  json,
  jsonError,
  readJson,
} from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';

interface RecommendationBody {
  postId?: unknown;
  commentId?: unknown;
}

function targetFrom(body: RecommendationBody) {
  const postId = typeof body.postId === 'string' && body.postId ? body.postId : null;
  const commentId = typeof body.commentId === 'string' && body.commentId ? body.commentId : null;
  if (Number(Boolean(postId)) + Number(Boolean(commentId)) !== 1) {
    throw new ApiError(400, 'INVALID_TARGET', '게시글 또는 댓글 하나만 지정해 주세요.');
  }
  return { postId, commentId };
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    enforceRateLimit(`recommendation:${session.user.id}`, {
      limit: 240,
      windowMs: 60 * 60 * 1_000,
    });
    const target = targetFrom(await readJson<RecommendationBody>(request));
    let commentPostId: string | null = null;
    if (target.commentId) {
      const preliminary = await prisma.comment.findUnique({
        where: { id: target.commentId },
        select: { postId: true },
      });
      if (!preliminary) {
        throw new ApiError(404, 'TARGET_NOT_FOUND', '추천 대상을 찾을 수 없습니다.');
      }
      commentPostId = preliminary.postId;
    }

    const recommendation = await prisma.$transaction(async (tx) => {
      await lockResources(tx, [
        ...(target.postId ? [`post:${target.postId}`] : []),
        ...(target.commentId ? [`comment:${target.commentId}`] : []),
        ...(commentPostId ? [`post:${commentPostId}`] : []),
      ]);
      let parentPostPublished = true;
      const entity: { id: string; authorId: string; status: string } | null = target.postId
        ? await tx.post.findUnique({
            where: { id: target.postId },
            select: { id: true, authorId: true, status: true },
          })
        : await (async () => {
            const comment = await tx.comment.findUnique({
              where: { id: target.commentId! },
              select: {
                id: true,
                authorId: true,
                status: true,
                post: { select: { status: true } },
              },
            });
            parentPostPublished = comment?.post.status === 'PUBLISHED';
            return comment
              ? { id: comment.id, authorId: comment.authorId, status: comment.status }
              : null;
          })();
      if (!entity || entity.status !== 'PUBLISHED' || !parentPostPublished) {
        throw new ApiError(404, 'TARGET_NOT_FOUND', '추천 대상을 찾을 수 없습니다.');
      }
      if (entity.authorId === session.user.id) {
        throw new ApiError(400, 'SELF_RECOMMENDATION', '자신의 콘텐츠는 추천할 수 없습니다.');
      }
      const created = await tx.recommendation.create({
        data: { userId: session.user.id, ...target },
      });
      if (target.postId) {
        await tx.post.update({
          where: { id: target.postId },
          data: { recommendationCount: { increment: 1 } },
        });
      } else {
        await tx.comment.update({
          where: { id: target.commentId! },
          data: { recommendationCount: { increment: 1 } },
        });
      }
      await awardIgk(tx, {
        userId: entity.authorId,
        counterpartyId: session.user.id,
        amount: 3,
        type: 'RECOMMENDATION_RECEIVED',
        idempotencyKey: `recommendation:${created.id}`,
        sourceType: target.postId ? 'POST' : 'COMMENT',
        sourceId: entity.id,
        dailyCap: 50,
        note: '추천받은 콘텐츠 보상',
      });
      await tx.notification.create({
        data: {
          userId: entity.authorId,
          actorId: session.user.id,
          type: 'RECOMMENDATION',
          title: '내 콘텐츠가 추천을 받았습니다.',
          href: target.postId
            ? `/post/${target.postId}`
            : commentPostId
              ? `/post/${commentPostId}#comment-${target.commentId}`
              : undefined,
          metadata: { ...target, recommendationId: created.id },
        },
      });
      return created;
    });
    return json({ recommendation }, 201);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return jsonError(new ApiError(409, 'ALREADY_RECOMMENDED', '이미 추천했습니다.'));
    }
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    const target = targetFrom(await readJson<RecommendationBody>(request));
    const recommendation = await prisma.recommendation.findFirst({
      where: { userId: session.user.id, ...target },
    });
    if (!recommendation) {
      throw new ApiError(404, 'RECOMMENDATION_NOT_FOUND', '추천 내역을 찾을 수 없습니다.');
    }
    const entity = target.postId
      ? await prisma.post.findUnique({ where: { id: target.postId }, select: { authorId: true } })
      : await prisma.comment.findUnique({ where: { id: target.commentId! }, select: { authorId: true } });

    await prisma.$transaction(async (tx) => {
      await tx.recommendation.delete({ where: { id: recommendation.id } });
      if (target.postId) {
        await tx.post.update({
          where: { id: target.postId },
          data: { recommendationCount: { decrement: 1 } },
        });
      } else {
        await tx.comment.update({
          where: { id: target.commentId! },
          data: { recommendationCount: { decrement: 1 } },
        });
      }
      if (entity) {
        await reverseReward(tx, {
          userId: entity.authorId,
          originalIdempotencyKey: `recommendation:${recommendation.id}`,
          idempotencyKey: `recommendation:remove:${recommendation.id}`,
          sourceType: target.postId ? 'POST' : 'COMMENT',
          sourceId: target.postId ?? target.commentId!,
          note: '추천 취소에 따른 보상 회수',
        });
      }
    });
    return json({ removed: true });
  } catch (error) {
    return jsonError(error);
  }
}
