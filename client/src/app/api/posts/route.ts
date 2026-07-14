import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { parseAttachmentIds, postListSelect, sanitizePostMetadata } from '@/lib/server/content';
import { awardIgk } from '@/lib/server/igk';
import {
  ApiError,
  assertSameOrigin,
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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await requireUser(request);
    const url = new URL(request.url);
    const { page, pageSize, skip } = parsePagination(url);
    const board = url.searchParams.get('board');
    const query = url.searchParams.get('q')?.trim().slice(0, 100);
    const sort = url.searchParams.get('sort') ?? 'latest';
    const filter = url.searchParams.get('filter') ?? 'all';
    const tag = url.searchParams.get('tag')?.trim().slice(0, 24);
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
              { author: { nickname: { contains: query, mode: 'insensitive' } } },
              { author: { realName: { contains: query, mode: 'insensitive' } } },
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
    const [posts, total] = await prisma.$transaction([
      prisma.post.findMany({
        where,
        orderBy: [{ isPinned: 'desc' }, secondary, { id: 'desc' }],
        skip,
        take: pageSize,
        select: postListSelect,
      }),
      prisma.post.count({ where }),
    ]);
    return json({ posts, pagination: paginationMeta(page, pageSize, total) });
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
    const body = await readJson<PostBody>(request, 128 * 1024);
    const boardIdentifier = requiredString(body.board ?? body.boardId, '게시판', { max: 64 });
    const status = body.status === 'DRAFT' ? 'DRAFT' : 'PUBLISHED';
    const rawTitle = typeof body.title === 'string' ? body.title.trim() : '';
    const rawContent = typeof body.content === 'string' ? body.content.trim() : '';
    if (rawTitle.length > 180 || rawContent.length > 50_000) {
      throw new ApiError(400, 'VALIDATION_ERROR', '제목은 180자, 본문은 50,000자 이하여야 합니다.');
    }
    if (status === 'DRAFT' && !rawTitle && !rawContent) {
      throw new ApiError(400, 'EMPTY_DRAFT', '임시저장할 제목이나 내용을 입력해 주세요.');
    }
    const title = status === 'DRAFT'
      ? rawTitle
      : requiredString(body.title, '제목', { min: 5, max: 180 });
    const content = status === 'DRAFT'
      ? rawContent
      : requiredString(body.content, '본문', { min: 1, max: 50_000, trim: false }).trim();
    const contentText = plainTextFromMarkup(content);
    if (status === 'PUBLISHED' && contentText.length < 20) {
      throw new ApiError(400, 'CONTENT_TOO_SHORT', '게시하려면 본문을 20자 이상 작성해 주세요.');
    }
    const tags = Array.isArray(body.tags)
      ? Array.from(new Set(body.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean)))
          .slice(0, 8)
          .map((tag) => tag.slice(0, 24))
      : [];
    const board = await prisma.board.findFirst({
      where: {
        status: 'ACTIVE',
        ...(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(boardIdentifier)
          ? { id: boardIdentifier }
          : { slug: boardIdentifier }),
      },
    });
    if (!board) throw new ApiError(404, 'BOARD_NOT_FOUND', '게시판을 찾을 수 없습니다.');
    const metadata = sanitizePostMetadata(body.metadata);
    const attachmentIds = parseAttachmentIds(body.attachmentIds);
    if (!attachmentIds) {
      throw new ApiError(400, 'INVALID_ATTACHMENTS', '첨부 파일은 최대 5개까지 올릴 수 있어요.');
    }

    const post = await prisma.$transaction(async (tx) => {
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
        select: postListSelect,
      });
      if (attachmentIds.length) {
        const attached = await tx.attachment.updateMany({
          where: {
            id: { in: attachmentIds },
            uploaderId: session.user.id,
            postId: null,
            messageId: null,
          },
          data: { postId: created.id },
        });
        if (attached.count !== attachmentIds.length) {
          throw new ApiError(400, 'INVALID_ATTACHMENTS', '첨부 파일 정보가 올바르지 않아요. 파일을 다시 선택해 주세요.');
        }
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
      return created;
    });
    return json({ post }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
