import prisma from '@/lib/prisma';
import { commentSelect } from '@/lib/server/content';
import {
  cursorDate,
  cursorScope,
  cursorString,
  decodeCursor,
  encodeCursor,
} from '@/lib/server/cursor';
import { awardIgk } from '@/lib/server/igk';
import { lockResources } from '@/lib/server/locks';
import {
  ApiError,
  assertSameOrigin,
  enforceDistributedRateLimit,
  enforceRateLimit,
  json,
  jsonError,
  paginationMeta,
  parsePagination,
  readJson,
  requiredString,
} from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';
import { createNotificationWithDelivery } from '@/lib/server/notifications';
import { maskPublicIdentities } from '@/lib/server/platform-mode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const url = new URL(request.url);
    const postId = requiredString(url.searchParams.get('postId'), 'postId', { max: 64 });
    const { page, pageSize, skip } = parsePagination(url, 100);
    const scope = cursorScope('post-comments', { postId });
    const cursorToken = url.searchParams.get('cursor');
    const cursorPosition = cursorToken ? decodeCursor(cursorToken, scope) : null;
    if (cursorPosition && cursorPosition.length !== 2) {
      throw new ApiError(400, 'INVALID_CURSOR', '페이지 커서가 올바르지 않거나 만료되었습니다.');
    }
    const cursorCreatedAt = cursorPosition ? cursorDate(cursorPosition[0]!) : null;
    const cursorId = cursorPosition ? cursorString(cursorPosition[1]!) : null;
    const post = await prisma.post.findFirst({
      where: {
        id: postId,
        status: 'PUBLISHED',
        board: { status: 'ACTIVE' },
      },
      select: { id: true, acceptedCommentId: true },
    });
    if (!post) throw new ApiError(404, 'POST_NOT_FOUND', '게시글을 찾을 수 없습니다.');
    const where = { postId: post.id, status: 'PUBLISHED' as const };
    const pageWhere = cursorCreatedAt && cursorId
      ? {
          ...where,
          OR: [
            { createdAt: { gt: cursorCreatedAt } },
            { createdAt: cursorCreatedAt, id: { gt: cursorId } },
          ],
        }
      : where;
    const [commentRows, total] = await prisma.$transaction([
      prisma.comment.findMany({
        where: pageWhere,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: cursorToken ? 0 : skip,
        take: pageSize + 1,
        select: commentSelect,
      }),
      prisma.comment.count({ where }),
    ]);
    const hasMore = commentRows.length > pageSize;
    const comments = commentRows.slice(0, pageSize);
    const viewerRecommendations = comments.length
      ? await prisma.recommendation.findMany({
          where: { userId: session.user.id, commentId: { in: comments.map((comment) => comment.id) } },
          select: { commentId: true },
        })
      : [];
    const recommendedIds = new Set(viewerRecommendations.flatMap((item) => item.commentId ? [item.commentId] : []));
    const publicComments = comments.map((comment) => ({
      ...comment,
      accepted: comment.id === post.acceptedCommentId,
      viewerRecommended: recommendedIds.has(comment.id),
    }));
    const lastComment = comments.at(-1);
    return json({
      comments: await maskPublicIdentities(publicComments, session.user.id),
      pagination: {
        ...paginationMeta(page, pageSize, total),
        cursor: cursorToken,
        nextCursor: hasMore && lastComment
          ? encodeCursor(scope, [lastComment.createdAt.toISOString(), lastComment.id])
          : null,
        hasMore,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

interface CommentBody {
  postId?: unknown;
  content?: unknown;
  parentId?: unknown;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    enforceRateLimit(`comment-create:${session.user.id}`, {
      limit: 120,
      windowMs: 60 * 60 * 1_000,
    });
    await enforceDistributedRateLimit(`comment-create:${session.user.id}`, {
      limit: 120,
      windowMs: 60 * 60 * 1_000,
      failPolicy: 'open',
    });
    const body = await readJson<CommentBody>(request, 16_384);
    const postId = requiredString(body.postId, 'postId', { max: 64 });
    const content = requiredString(body.content, '댓글', { min: 1, max: 3_000 });
    const parentId = typeof body.parentId === 'string' && body.parentId ? body.parentId : null;
    const comment = await prisma.$transaction(async (tx) => {
      await lockResources(tx, [
        `post:${postId}`,
        ...(parentId ? [`comment:${parentId}`] : []),
      ]);
      const post = await tx.post.findUnique({
        where: { id: postId },
        select: { id: true, authorId: true, status: true, isLocked: true },
      });
      if (!post || post.status !== 'PUBLISHED') {
        throw new ApiError(404, 'POST_NOT_FOUND', '게시글을 찾을 수 없습니다.');
      }
      if (post.isLocked) {
        throw new ApiError(409, 'POST_LOCKED', '댓글 작성이 잠긴 게시글입니다.');
      }
      let parentAuthorId: string | null = null;
      if (parentId) {
        const parent = await tx.comment.findUnique({
          where: { id: parentId },
          select: { postId: true, parentId: true, authorId: true, status: true },
        });
        if (!parent || parent.postId !== postId || parent.status !== 'PUBLISHED') {
          throw new ApiError(400, 'INVALID_PARENT', '답글 대상 댓글을 찾을 수 없습니다.');
        }
        if (parent.parentId) {
          throw new ApiError(400, 'REPLY_DEPTH_LIMIT', '대댓글에는 다시 답글을 달 수 없습니다.');
        }
        parentAuthorId = parent.authorId;
      }
      const created = await tx.comment.create({
        data: { postId, authorId: session.user.id, parentId, content },
        select: commentSelect,
      });
      await tx.post.update({ where: { id: postId }, data: { commentCount: { increment: 1 } } });
      await awardIgk(tx, {
        userId: session.user.id,
        amount: 2,
        type: 'COMMENT_CREATED',
        idempotencyKey: `comment:create:${created.id}`,
        sourceType: 'COMMENT',
        sourceId: created.id,
        dailyCap: 100,
        note: '댓글 작성 보상',
      });
      const recipientId = parentAuthorId ?? post.authorId;
      if (recipientId !== session.user.id) {
        await createNotificationWithDelivery(tx, {
            userId: recipientId,
            actorId: session.user.id,
            type: parentId ? 'REPLY' : 'COMMENT',
            title: parentId ? '내 댓글에 답글이 달렸습니다.' : '내 게시글에 댓글이 달렸습니다.',
            body: content.slice(0, 120),
            href: `/post/${postId}#comment-${created.id}`,
            metadata: { postId, commentId: created.id },
        });
      }
      return created;
    });
    return json({ comment: await maskPublicIdentities(comment, session.user.id) }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
