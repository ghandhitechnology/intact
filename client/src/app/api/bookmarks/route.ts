import prisma from '@/lib/prisma';
import { postListSelect } from '@/lib/server/content';
import {
  ApiError,
  assertSameOrigin,
  isUniqueConstraintError,
  json,
  jsonError,
  readJson,
  requiredString,
} from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';
import { maskPublicIdentities } from '@/lib/server/platform-mode';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const bookmarks = await prisma.bookmark.findMany({
      where: { userId: session.user.id, post: { status: 'PUBLISHED' } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, createdAt: true, folder: true, post: { select: postListSelect } },
    });
    return json({ bookmarks: await maskPublicIdentities(bookmarks, session.user.id) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    const body = await readJson<{ postId?: unknown; folder?: unknown }>(request);
    const postId = requiredString(body.postId, 'postId', { max: 64 });
    const post = await prisma.post.findUnique({ where: { id: postId }, select: { status: true } });
    if (!post || post.status !== 'PUBLISHED') throw new ApiError(404, 'POST_NOT_FOUND', '게시글을 찾을 수 없습니다.');
    const folder = typeof body.folder === 'string' ? body.folder.trim().slice(0, 60) || null : null;
    let bookmark;
    try {
      bookmark = await prisma.$transaction(async (tx) => {
        const created = await tx.bookmark.create({
          data: {
            userId: session.user.id,
            postId,
            folder,
          },
        });
        await tx.post.update({ where: { id: postId }, data: { bookmarkCount: { increment: 1 } } });
        return created;
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      bookmark = await prisma.bookmark.update({
        where: { userId_postId: { userId: session.user.id, postId } },
        data: { folder },
      });
    }
    return json({ bookmark }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    const body = await readJson<{ postId?: unknown }>(request);
    const postId = requiredString(body.postId, 'postId', { max: 64 });
    const existing = await prisma.bookmark.findUnique({
      where: { userId_postId: { userId: session.user.id, postId } },
    });
    if (!existing) return json({ removed: true });
    await prisma.$transaction([
      prisma.bookmark.delete({ where: { id: existing.id } }),
      prisma.post.update({ where: { id: postId }, data: { bookmarkCount: { decrement: 1 } } }),
    ]);
    return json({ removed: true });
  } catch (error) {
    return jsonError(error);
  }
}
