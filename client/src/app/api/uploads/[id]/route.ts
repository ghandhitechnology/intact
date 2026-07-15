import prisma from '@/lib/prisma';
import { deleteObject, getObject } from '@/lib/server/object-storage';
import { putObject } from '@/lib/server/object-storage';
import sharp from 'sharp';
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

    const url = new URL(request.url);
    const requestedWidth = Number(url.searchParams.get('w'));
    const thumbnail = url.searchParams.get('variant') === 'thumb' && [320, 640, 1280].includes(requestedWidth);
    if (url.searchParams.has('variant') && !thumbnail) {
      throw new ApiError(400, 'INVALID_IMAGE_VARIANT', '지원하지 않는 이미지 크기입니다.');
    }
    if (thumbnail && !attachment.mimeType.startsWith('image/')) {
      throw new ApiError(400, 'NOT_AN_IMAGE', '이미지 파일만 썸네일을 만들 수 있습니다.');
    }
    const etag = `"${attachment.sha256}${thumbnail ? `-thumb-${requestedWidth}` : ''}"`;
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }
    let object;
    let thumbnailBytes: Buffer | null = null;
    if (thumbnail) {
      const derivativeKey = `${attachment.storageKey}.thumb-${requestedWidth}.webp`;
      try {
        object = await getObject(derivativeKey);
      } catch {
        const original = await getObject(attachment.storageKey);
        const originalBytes = Buffer.from(await original.arrayBuffer());
        thumbnailBytes = await sharp(originalBytes, { animated: false })
          .rotate()
          .resize({ width: requestedWidth, withoutEnlargement: true })
          .webp({ quality: 78 })
          .toBuffer();
        await putObject(derivativeKey, thumbnailBytes, 'image/webp');
        object = null;
      }
    } else {
      object = await getObject(attachment.storageKey);
    }
    const asciiName = attachment.originalName.replace(/[^A-Za-z0-9._-]/g, '_') || 'download';
    const inline = url.searchParams.get('download') !== '1' && INLINE_MIME_TYPES.has(attachment.mimeType);
    return new Response(thumbnailBytes ? new Uint8Array(thumbnailBytes) : object?.body, {
      headers: {
        'Content-Type': thumbnail ? 'image/webp' : attachment.mimeType || 'application/octet-stream',
        ...(thumbnailBytes ? { 'Content-Length': String(thumbnailBytes.byteLength) } : !thumbnail ? { 'Content-Length': String(attachment.sizeBytes) } : {}),
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`,
        'Cache-Control': thumbnail ? 'private, max-age=86400, must-revalidate' : 'private, max-age=300, must-revalidate',
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
    await Promise.all([
      deleteObject(attachment.storageKey),
      ...[320, 640, 1280].map((width) => deleteObject(`${attachment.storageKey}.thumb-${width}.webp`).catch(() => undefined)),
    ]);
    await prisma.attachment.delete({ where: { id: attachment.id } });
    return json({ deleted: true });
  } catch (error) {
    return jsonError(error);
  }
}
