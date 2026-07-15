import prisma from '@/lib/prisma';
import { commentSelect, isPhotoMimeType, parseAttachmentIds, publicAuthorSelect, sanitizePostMetadata } from '@/lib/server/content';
import { awardIgk, reverseReward } from '@/lib/server/igk';
import { lockResources } from '@/lib/server/locks';
import {
  ApiError,
  assertSameOrigin,
  json,
  jsonError,
  plainTextFromMarkup,
  readJson,
  requiredString,
} from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';
import { maskPublicIdentities } from '@/lib/server/platform-mode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const detailSelect = {
  id: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  scheduledFor: true,
  editedAt: true,
  kind: true,
  status: true,
  title: true,
  content: true,
  tags: true,
  metadata: true,
  viewCount: true,
  commentCount: true,
  recommendationCount: true,
  bookmarkCount: true,
  isPinned: true,
  isLocked: true,
  acceptedCommentId: true,
  board: { select: { id: true, slug: true, name: true, kind: true } },
  author: { select: publicAuthorSelect },
  acceptedComment: { select: commentSelect },
  comments: {
    where: { status: 'PUBLISHED' as const },
    orderBy: { createdAt: 'asc' as const },
    select: commentSelect,
  },
  attachments: {
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      sizeBytes: true,
      width: true,
      height: true,
      blurDataUrl: true,
      sha256: true,
      scanStatus: true,
    },
  },
} as const;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const viewer = await requireUser(request);
    const existing = await prisma.post.findUnique({
      where: { id },
      select: { authorId: true, status: true },
    });
    if (!existing) throw new ApiError(404, 'POST_NOT_FOUND', '게시글을 찾을 수 없습니다.');
    const privileged = viewer.user.id === existing.authorId;
    if (existing.status !== 'PUBLISHED' && !privileged) {
      throw new ApiError(404, 'POST_NOT_FOUND', '게시글을 찾을 수 없습니다.');
    }

    const post = existing.status === 'PUBLISHED'
      ? await prisma.post.update({
          where: { id },
          data: { viewCount: { increment: 1 } },
          select: detailSelect,
        })
      : await prisma.post.findUniqueOrThrow({
          where: { id },
          select: detailSelect,
        });
    const [viewerRecommendation, viewerBookmark, viewerCommentRecommendations] = await prisma.$transaction([
      prisma.recommendation.findFirst({
        where: { userId: viewer.user.id, postId: post.id },
        select: { id: true },
      }),
      prisma.bookmark.findUnique({
        where: { userId_postId: { userId: viewer.user.id, postId: post.id } },
        select: { id: true },
      }),
      prisma.recommendation.findMany({
        where: {
          userId: viewer.user.id,
          commentId: { in: post.comments.map((comment) => comment.id) },
        },
        select: { commentId: true },
      }),
    ]);
    const recommendedCommentIds = new Set(
      viewerCommentRecommendations.flatMap((item) => item.commentId ? [item.commentId] : []),
    );
    return json({
      post: await maskPublicIdentities({
        ...post,
        comments: post.comments.map((comment) => ({
          ...comment,
          viewerRecommended: recommendedCommentIds.has(comment.id),
        })),
        viewerState: {
          recommended: Boolean(viewerRecommendation),
          bookmarked: Boolean(viewerBookmark),
        },
      }, viewer.user.id),
    });
  } catch (error) {
    return jsonError(error);
  }
}

interface UpdateBody {
  title?: unknown;
  content?: unknown;
  tags?: unknown;
  metadata?: unknown;
  status?: unknown;
  board?: unknown;
  editReason?: unknown;
  attachmentIds?: unknown;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    assertSameOrigin(request);
    const session = await requireUser(request);
    const body = await readJson<UpdateBody>(request, 128 * 1024);
    const old = await prisma.post.findUnique({ where: { id }, include: { board: true } });
    if (!old || old.status === 'DELETED') {
      throw new ApiError(404, 'POST_NOT_FOUND', '게시글을 찾을 수 없습니다.');
    }
    if (old.authorId !== session.user.id) {
      throw new ApiError(403, 'NOT_POST_OWNER', '게시글을 수정할 권한이 없습니다.');
    }

    let targetBoard = old.board;
    if (body.board !== undefined) {
      const identifier = requiredString(body.board, '게시판', { max: 64 });
      const board = await prisma.board.findFirst({ where: {
        status: 'ACTIVE',
        ...(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(identifier)
          ? { id: identifier }
          : { slug: identifier }),
      } });
      if (!board) throw new ApiError(404, 'BOARD_NOT_FOUND', '게시판을 찾을 수 없습니다.');
      targetBoard = board;
    }
    const photoPost = targetBoard.slug === 'photos';
    const requestedStatus = body.status === 'DRAFT' || body.status === 'PUBLISHED'
      ? body.status
      : null;
    const targetStatus = requestedStatus ?? old.status;
    const rawTitle = body.title === undefined
      ? old.title
      : typeof body.title === 'string' ? body.title.trim() : '';
    const rawContent = body.content === undefined
      ? old.content
      : typeof body.content === 'string' ? body.content.trim() : '';
    if (rawTitle.length > 180 || rawContent.length > 50_000) {
      throw new ApiError(400, 'VALIDATION_ERROR', '제목은 180자, 본문은 50,000자 이하여야 합니다.');
    }
    const attachmentIds = parseAttachmentIds(body.attachmentIds, photoPost ? 12 : 5);
    if (!attachmentIds) {
      throw new ApiError(400, 'INVALID_ATTACHMENTS', `첨부 파일은 최대 ${photoPost ? 12 : 5}개까지 올릴 수 있어요.`);
    }
    if (targetStatus === 'DRAFT' && !rawTitle && !rawContent && attachmentIds.length === 0) {
      throw new ApiError(400, 'EMPTY_DRAFT', '임시저장할 제목이나 내용을 입력해 주세요.');
    }
    const title = targetStatus === 'DRAFT'
      ? rawTitle
      : requiredString(rawTitle, '제목', { min: photoPost ? 2 : 5, max: 180 });
    const content = photoPost
      ? ''
      : targetStatus === 'DRAFT'
        ? rawContent
        : requiredString(rawContent, '본문', { min: 1, max: 50_000, trim: false }).trim();
    const contentText = plainTextFromMarkup(content);
    if (!photoPost && targetStatus === 'PUBLISHED' && contentText.length < 20) {
      throw new ApiError(400, 'CONTENT_TOO_SHORT', '게시하려면 본문을 20자 이상 작성해 주세요.');
    }
    const tags = photoPost
      ? []
      : body.tags === undefined
      ? old.tags
      : Array.isArray(body.tags)
        ? Array.from(new Set(body.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean)))
            .slice(0, 8)
            .map((tag) => tag.slice(0, 24))
        : [];
    const boardId = targetBoard.id;
    const kind = targetBoard.kind;
    const editReason = typeof body.editReason === 'string'
      ? body.editReason.trim().slice(0, 300)
      : null;
    const post = await prisma.$transaction(async (tx) => {
      await lockResources(tx, [`post:${old.id}`]);
      const current = await tx.post.findUnique({ where: { id: old.id } });
      if (!current || current.status === 'DELETED') {
        throw new ApiError(404, 'POST_NOT_FOUND', '게시글을 찾을 수 없습니다.');
      }
      if (current.authorId !== session.user.id) {
        throw new ApiError(403, 'NOT_POST_OWNER', '게시글을 수정할 권한이 없습니다.');
      }
      if (current.status === 'HIDDEN') {
        throw new ApiError(403, 'POST_MODERATED', '관리자에 의해 숨겨진 게시글은 수정하거나 재게시할 수 없습니다.');
      }
      if (current.updatedAt.getTime() !== old.updatedAt.getTime()) {
        throw new ApiError(409, 'STALE_POST', '게시글 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.');
      }
      let status = current.status;
      if (requestedStatus && requestedStatus !== current.status) {
        if (current.status === 'DRAFT' && requestedStatus === 'PUBLISHED') {
          status = 'PUBLISHED';
        } else {
          throw new ApiError(
            409,
            'INVALID_STATUS_TRANSITION',
            '작성자는 임시저장 글만 게시 상태로 전환할 수 있습니다.',
          );
        }
      }
      if (title !== current.title || content !== current.content) {
        await tx.postRevision.create({
          data: {
            postId: current.id,
            editorId: session.user.id,
            title: current.title,
            content: current.content,
            reason: editReason,
          },
        });
      }
      if (attachmentIds.length) {
        const candidateAttachments = await tx.attachment.findMany({
          where: {
            id: { in: attachmentIds },
            uploaderId: session.user.id,
            messageId: null,
            OR: [{ postId: null }, { postId: current.id }],
          },
          select: { id: true, mimeType: true },
        });
        if (candidateAttachments.length !== attachmentIds.length) {
          throw new ApiError(400, 'INVALID_ATTACHMENTS', '첨부 파일 정보가 올바르지 않아요. 파일을 다시 선택해 주세요.');
        }
        if (photoPost && candidateAttachments.some((attachment) => !isPhotoMimeType(attachment.mimeType))) {
          throw new ApiError(400, 'IMAGES_ONLY', '사진게시판에는 이미지만 올릴 수 있어요.');
        }
        const attached = await tx.attachment.updateMany({
          where: {
            id: { in: attachmentIds },
            uploaderId: session.user.id,
            messageId: null,
            OR: [{ postId: null }, { postId: current.id }],
          },
          data: { postId: current.id },
        });
        if (attached.count !== attachmentIds.length) {
          throw new ApiError(400, 'INVALID_ATTACHMENTS', '첨부 파일 정보가 올바르지 않아요. 파일을 다시 선택해 주세요.');
        }
      }
      if (photoPost) {
        const photos = await tx.attachment.findMany({
          where: { postId: current.id },
          select: { id: true, mimeType: true },
        });
        if (photos.length > 12 || photos.some((attachment) => !isPhotoMimeType(attachment.mimeType))) {
          throw new ApiError(400, 'IMAGES_ONLY', '사진게시판에는 이미지를 최대 12장까지 올릴 수 있어요.');
        }
        if (targetStatus === 'PUBLISHED' && photos.length === 0) {
          throw new ApiError(400, 'PHOTO_REQUIRED', '사진을 한 장 이상 골라 주세요.');
        }
      }
      const updated = await tx.post.update({
        where: { id: current.id },
        data: {
          title,
          content,
          contentText,
          tags,
          status,
          boardId,
          kind,
          metadata: body.metadata === undefined ? undefined : sanitizePostMetadata(body.metadata),
          editedAt:
            title !== current.title || content !== current.content
              ? new Date()
              : current.editedAt,
          publishedAt:
            status === 'PUBLISHED' && current.status === 'DRAFT'
              ? new Date()
              : current.publishedAt,
        },
        select: detailSelect,
      });
      if (status === 'PUBLISHED' && current.status === 'DRAFT') {
        await awardIgk(tx, {
          userId: current.authorId,
          amount: 10,
          type: 'POST_CREATED',
          idempotencyKey: `post:create:${current.id}`,
          sourceType: 'POST',
          sourceId: current.id,
          dailyCap: 100,
          note: '게시글 작성 보상',
        });
      }
      return updated;
    });
    return json({ post: await maskPublicIdentities(post, session.user.id) });
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
    const post = await prisma.post.findUnique({ where: { id } });
    if (!post) throw new ApiError(404, 'POST_NOT_FOUND', '게시글을 찾을 수 없습니다.');
    if (post.authorId !== session.user.id) {
      throw new ApiError(403, 'NOT_POST_OWNER', '게시글을 삭제할 권한이 없습니다.');
    }
    if (post.status === 'DELETED') return json({ deleted: true });

    await prisma.$transaction(async (tx) => {
      await lockResources(tx, [`post:${post.id}`]);
      const current = await tx.post.findUnique({ where: { id: post.id } });
      if (!current || current.status === 'DELETED') return;
      const recommendations = await tx.recommendation.findMany({
        where: { postId: current.id },
        select: { id: true },
      });
      await tx.post.update({
        where: { id: current.id },
        data: { status: 'DELETED', deletedAt: new Date() },
      });
      await reverseReward(tx, {
        userId: current.authorId,
        originalIdempotencyKey: `post:create:${current.id}`,
        idempotencyKey: `post:delete:${current.id}`,
        sourceType: 'POST',
        sourceId: current.id,
        note: '게시글 삭제에 따른 보상 회수',
      });
      for (const recommendation of recommendations) {
        await reverseReward(tx, {
          userId: current.authorId,
          originalIdempotencyKey: `recommendation:${recommendation.id}`,
          idempotencyKey: `recommendation:post-delete:${recommendation.id}`,
          sourceType: 'POST',
          sourceId: current.id,
          note: '삭제된 게시글의 추천 보상 회수',
        });
      }
    });
    return json({ deleted: true });
  } catch (error) {
    return jsonError(error);
  }
}
