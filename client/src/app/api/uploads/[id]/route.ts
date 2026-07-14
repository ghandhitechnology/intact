import prisma from '@/lib/prisma';
import { deleteObject, getObject } from '@/lib/server/object-storage';
import { ApiError, assertSameOrigin, json, jsonError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';

const INLINE_MIME_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'video/mp4',
  'video/webm',
]);

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(request);
    const { id } = await context.params;
    const attachment = await prisma.attachment.findUnique({
      where: { id },
      include: {
        post: { select: { status: true, authorId: true } },
        message: {
          select: {
            room: {
              select: {
                members: {
                  where: { userId: session.user.id, leftAt: null },
                  select: { userId: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });
    if (!attachment) throw new ApiError(404, 'FILE_NOT_FOUND', '파일을 찾을 수 없어요.');
    const canReadPost = Boolean(
      attachment.post &&
        (attachment.post.status === 'PUBLISHED' || attachment.post.authorId === session.user.id),
    );
    const canReadMessage = Boolean(attachment.message?.room.members.length);
    const canReadUnattached = !attachment.postId && !attachment.messageId && attachment.uploaderId === session.user.id;
    if (!canReadPost && !canReadMessage && !canReadUnattached) {
      throw new ApiError(404, 'FILE_NOT_FOUND', '파일을 찾을 수 없어요.');
    }

    const etag = `"${attachment.sha256}"`;
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }
    const object = await getObject(attachment.storageKey);
    const asciiName = attachment.originalName.replace(/[^A-Za-z0-9._-]/g, '_') || 'download';
    const url = new URL(request.url);
    const inline = url.searchParams.get('download') !== '1' && INLINE_MIME_TYPES.has(attachment.mimeType);
    return new Response(object.body, {
      headers: {
        'Content-Type': attachment.mimeType || 'application/octet-stream',
        'Content-Length': String(attachment.sizeBytes),
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`,
        'Cache-Control': 'private, max-age=300, must-revalidate',
        'Cross-Origin-Resource-Policy': 'same-origin',
        ETag: etag,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    const { id } = await context.params;
    const attachment = await prisma.attachment.findUnique({
      where: { id },
      select: { id: true, uploaderId: true, storageKey: true },
    });
    if (!attachment || attachment.uploaderId !== session.user.id) {
      throw new ApiError(404, 'FILE_NOT_FOUND', '파일을 찾을 수 없어요.');
    }
    await deleteObject(attachment.storageKey);
    await prisma.attachment.delete({ where: { id: attachment.id } });
    return json({ deleted: true });
  } catch (error) {
    return jsonError(error);
  }
}
