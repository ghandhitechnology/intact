import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { bindEligibleAttachments } from '@/lib/server/attachment-state';
import { isPhotoMimeType, parseAttachmentIds, postListSelect, sanitizePostMetadata } from '@/lib/server/content';
import {
  cursorBoolean,
  cursorDate,
  cursorNumber,
  cursorScope,
  cursorString,
  decodeCursor,
  encodeCursor,
  type CursorScalar,
} from '@/lib/server/cursor';
import { awardIgk } from '@/lib/server/igk';
import {
  ApiError,
  assertSameOrigin,
  enforceDistributedRateLimit,
  enforceRateLimit,
  json,
  jsonError,
  paginationMeta,
  parsePagination,
  plainTextFromMarkup,
  readJson,
  requiredString,
} from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';
import { getPlatformMode, maskPublicIdentities, maskPublicIdentitiesWithMode } from '@/lib/server/platform-mode';
import { postVersionEtag } from '@/lib/server/post-version';
import { getModerationMode, publicModerationStatus, queueModerationSubmission } from '@/lib/server/moderation';
import { assertAttachmentAllowedOnBoard } from '@/lib/server/multipart-upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PostSort = 'latest' | 'recommended' | 'comments' | 'views';

function normalizedPostSort(value: string | null): PostSort {
  return value === 'recommended' || value === 'comments' || value === 'views'
    ? value
    : 'latest';
}

function postCursorWhere(sort: PostSort, position: CursorScalar[]): Prisma.PostWhereInput {
  if (position.length !== 3) {
    throw new ApiError(400, 'INVALID_CURSOR', '페이지 커서가 올바르지 않거나 만료되었습니다.');
  }
  const isPinned = cursorBoolean(position[0]!);
  const id = cursorString(position[2]!);
  const pinnedBoundary: Prisma.PostWhereInput[] = isPinned ? [{ isPinned: false }] : [];
  if (sort === 'latest') {
    const publishedAt = cursorDate(position[1]!);
    return {
      OR: [
        ...pinnedBoundary,
        { isPinned, publishedAt: { lt: publishedAt } },
        { isPinned, publishedAt, id: { lt: id } },
      ],
    };
  }
  const value = cursorNumber(position[1]!);
  const field = sort === 'recommended'
    ? 'recommendationCount'
    : sort === 'comments'
      ? 'commentCount'
      : 'viewCount';
  return {
    OR: [
      ...pinnedBoundary,
      { isPinned, [field]: { lt: value } },
      { isPinned, [field]: value, id: { lt: id } },
    ],
  };
}

function postCursorPosition(post: {
  id: string;
  isPinned: boolean;
  publishedAt: Date | null;
  recommendationCount: number;
  commentCount: number;
  viewCount: number;
}, sort: PostSort): CursorScalar[] {
  const secondary = sort === 'recommended'
    ? post.recommendationCount
    : sort === 'comments'
      ? post.commentCount
      : sort === 'views'
        ? post.viewCount
        : post.publishedAt?.toISOString() ?? post.id;
  return [post.isPinned, secondary, post.id];
}

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const platformMode = await getPlatformMode();
    const url = new URL(request.url);
    const { page, pageSize, skip } = parsePagination(url);
    const board = url.searchParams.get('board');
    const query = url.searchParams.get('q')?.trim().slice(0, 100);
    const sort = normalizedPostSort(url.searchParams.get('sort'));
    const filter = url.searchParams.get('filter') ?? 'all';
    const tag = url.searchParams.get('tag')?.trim().slice(0, 24);
    const scope = cursorScope('posts', { board, query, sort, filter, tag });
    const cursorToken = url.searchParams.get('cursor');
    const cursorWhere = cursorToken
      ? postCursorWhere(sort, decodeCursor(cursorToken, scope))
      : null;
    const where: Prisma.PostWhereInput = {
      status: 'PUBLISHED',
      publishedAt: { lte: new Date() },
      ...(board ? { board: { slug: board, status: 'ACTIVE' } } : { board: { status: 'ACTIVE' } }),
      ...(filter === 'popular' ? { recommendationCount: { gte: 10 } } : {}),
      ...(filter === 'solved' ? { acceptedCommentId: { not: null } } : {}),
      ...(filter === 'files' ? { attachments: { some: {} } } : {}),
      ...(tag ? { tags: { has: tag } } : {}),
      ...(query
        ? {
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
              { contentText: { contains: query, mode: 'insensitive' } },
              { tags: { has: query } },
              ...(!platformMode.bSideEnabled
                ? [
                    { author: { nickname: { contains: query, mode: 'insensitive' as const } } },
                    { author: { realName: { contains: query, mode: 'insensitive' as const } } },
                  ]
                : []),
            ],
          }
        : {}),
    };
    const secondary: Prisma.PostOrderByWithRelationInput =
      sort === 'recommended'
        ? { recommendationCount: 'desc' }
        : sort === 'comments'
          ? { commentCount: 'desc' }
          : sort === 'views'
            ? { viewCount: 'desc' }
            : { publishedAt: 'desc' };
    const [postRows, total] = await prisma.$transaction([
      prisma.post.findMany({
        where: cursorWhere ? { AND: [where, cursorWhere] } : where,
        orderBy: [{ isPinned: 'desc' }, secondary, { id: 'desc' }],
        skip: cursorToken ? 0 : skip,
        take: pageSize + 1,
        select: postListSelect,
      }),
      prisma.post.count({ where }),
    ]);
    const hasMore = postRows.length > pageSize;
    const posts = postRows.slice(0, pageSize);
    const lastPost = posts.at(-1);
    const nextCursor = hasMore && lastPost
      ? encodeCursor(scope, postCursorPosition(lastPost, sort))
      : null;
    return json({
      posts: maskPublicIdentitiesWithMode(posts, session.user.id, platformMode),
      pagination: {
        ...paginationMeta(page, pageSize, total),
        cursor: cursorToken,
        nextCursor,
        hasMore,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

interface PostBody {
  board?: unknown;
  boardId?: unknown;
  title?: unknown;
  content?: unknown;
  tags?: unknown;
  metadata?: unknown;
  status?: unknown;
  attachmentIds?: unknown;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    enforceRateLimit(`post-create:${session.user.id}`, {
      limit: 20,
      windowMs: 60 * 60 * 1_000,
    });
    await enforceDistributedRateLimit(`post-create:${session.user.id}`, {
      limit: 20,
      windowMs: 60 * 60 * 1_000,
      failPolicy: 'open',
    });
    const body = await readJson<PostBody>(request, 128 * 1024);
    const boardIdentifier = requiredString(body.board ?? body.boardId, '게시판', { max: 64 });
    const board = await prisma.board.findFirst({
      where: {
        status: 'ACTIVE',
        ...(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(boardIdentifier)
          ? { id: boardIdentifier }
          : { slug: boardIdentifier }),
      },
    });
    if (!board) throw new ApiError(404, 'BOARD_NOT_FOUND', '게시판을 찾을 수 없습니다.');
    const photoPost = board.slug === 'photos';
    const requestedStatus = body.status === 'DRAFT' ? 'DRAFT' : 'PUBLISHED';
    const moderationMode = getModerationMode();
    const status = requestedStatus === 'PUBLISHED' && moderationMode === 'ENFORCE'
      ? 'PENDING_MODERATION'
      : requestedStatus;
    const rawTitle = typeof body.title === 'string' ? body.title.trim() : '';
    const rawContent = typeof body.content === 'string' ? body.content.trim() : '';
    if (rawTitle.length > 180 || rawContent.length > 50_000) {
      throw new ApiError(400, 'VALIDATION_ERROR', '제목은 180자, 본문은 50,000자 이하여야 합니다.');
    }
    const attachmentIds = parseAttachmentIds(body.attachmentIds, photoPost ? 12 : 5);
    if (!attachmentIds) {
      throw new ApiError(400, 'INVALID_ATTACHMENTS', `첨부 파일은 최대 ${photoPost ? 12 : 5}개까지 올릴 수 있어요.`);
    }
    if (requestedStatus === 'DRAFT' && !rawTitle && !rawContent && attachmentIds.length === 0) {
      throw new ApiError(400, 'EMPTY_DRAFT', '임시저장할 제목이나 내용을 입력해 주세요.');
    }
    const title = requestedStatus === 'DRAFT'
      ? rawTitle
      : requiredString(body.title, '제목', { min: photoPost ? 2 : 5, max: 180 });
    const content = photoPost
      ? ''
      : requestedStatus === 'DRAFT'
        ? rawContent
        : requiredString(body.content, '본문', { min: 1, max: 50_000, trim: false }).trim();
    const contentText = plainTextFromMarkup(content);
    if (!photoPost && requestedStatus === 'PUBLISHED' && contentText.length < 20) {
      throw new ApiError(400, 'CONTENT_TOO_SHORT', '게시하려면 본문을 20자 이상 작성해 주세요.');
    }
    if (photoPost && requestedStatus === 'PUBLISHED' && attachmentIds.length === 0) {
      throw new ApiError(400, 'PHOTO_REQUIRED', '사진을 한 장 이상 골라 주세요.');
    }
    const tags = !photoPost && Array.isArray(body.tags)
      ? Array.from(new Set(body.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean)))
          .slice(0, 8)
          .map((tag) => tag.slice(0, 24))
      : [];
    const metadata = sanitizePostMetadata(body.metadata);

    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.post.create({
        data: {
          boardId: board.id,
          authorId: session.user.id,
          kind: board.kind,
          status,
          title,
          content,
          contentText,
          tags,
          metadata,
          publishedAt: status === 'PUBLISHED' ? new Date() : null,
        },
        select: { ...postListSelect, version: true },
      });
      if (attachmentIds.length) {
        const pendingAttachments = await tx.attachment.findMany({
          where: {
            id: { in: attachmentIds },
            uploaderId: session.user.id,
            postId: null,
            messageId: null,
          },
          select: { id: true, mimeType: true, storageKey: true, sizeBytes: true },
        });
        if (pendingAttachments.length !== attachmentIds.length) {
          throw new ApiError(400, 'INVALID_ATTACHMENTS', '첨부 파일 정보가 올바르지 않아요. 파일을 다시 선택해 주세요.');
        }
        if (photoPost && pendingAttachments.some((attachment) => !isPhotoMimeType(attachment.mimeType))) {
          throw new ApiError(400, 'IMAGES_ONLY', '사진게시판에는 이미지만 올릴 수 있어요.');
        }
        assertAttachmentAllowedOnBoard(board.slug, pendingAttachments);
        await bindEligibleAttachments(tx, {
          attachmentIds,
          uploaderId: session.user.id,
          binding: { postId: created.id },
        });
      }
      let moderation = null;
      if (requestedStatus === 'PUBLISHED' && moderationMode !== 'OFF') {
        moderation = await queueModerationSubmission(tx, {
          postId: created.id,
          authorId: session.user.id,
          basePostUpdatedAt: created.updatedAt,
          title,
          content,
          contentText,
          tags,
          metadata,
          boardId: board.id,
          kind: board.kind,
          attachmentIds,
          isNewPost: moderationMode === 'ENFORCE',
        });
      }
      if (status === 'PUBLISHED') {
        await awardIgk(tx, {
          userId: session.user.id,
          amount: 10,
          type: 'POST_CREATED',
          idempotencyKey: `post:create:${created.id}`,
          sourceType: 'POST',
          sourceId: created.id,
          dailyCap: 100,
          note: '게시글 작성 보상',
        });
      }
      return { post: created, moderation };
    });
    return json({
      post: await maskPublicIdentities(result.post, session.user.id),
      moderation: result.moderation
        ? { ...publicModerationStatus(result.moderation), enforced: moderationMode === 'ENFORCE' }
        : null,
    }, result.moderation ? 202 : 201, {
      ETag: postVersionEtag(result.post),
    });
  } catch (error) {
    return jsonError(error);
  }
}
