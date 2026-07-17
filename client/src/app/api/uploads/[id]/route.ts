import prisma from '@/lib/prisma';
import {
  attachmentObjectKeys,
  assertDeleteEligibleAttachment,
  ATTACHMENT_STATUS,
  isLegacyReadableAttachment,
  isReadableAttachment,
} from '@/lib/server/attachment-state';
import { parseMultipartUploadMetadata, publicStorageOrigin } from '@/lib/server/multipart-upload';
import { abortMultipartUpload, deleteObjects, presignObjectRequest } from '@/lib/server/object-storage';
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
        profileForUser: { select: { id: true, status: true } },
      },
    });
    if (!attachment || !isReadableAttachment(attachment)) {
      throw new ApiError(404, 'FILE_NOT_FOUND', '파일을 찾을 수 없어요.');
    }
    const legacyAttachment = isLegacyReadableAttachment(attachment);
    const canReadPost = Boolean(
      attachment.post
        && (attachment.post.status === 'PUBLISHED' || attachment.post.authorId === session.user.id),
    );
    const canReadMessage = Boolean(attachment.message?.room.members.length);
    const canReadProfile = attachment.profileForUser?.status === 'ACTIVE';
    const canReadUnattached = !attachment.postId && !attachment.messageId && attachment.uploaderId === session.user.id;
    if (!canReadPost && !canReadMessage && !canReadProfile && !canReadUnattached) {
      throw new ApiError(404, 'FILE_NOT_FOUND', '파일을 찾을 수 없어요.');
    }

    const url = new URL(request.url);
    const requestedWidth = Number(url.searchParams.get('w'));
    const thumbnail = url.searchParams.get('variant') === 'thumb' && [320, 640, 1280].includes(requestedWidth);
    const avatar = url.searchParams.get('variant') === 'avatar';
    if (url.searchParams.has('variant') && !thumbnail && !avatar) {
      throw new ApiError(400, 'INVALID_IMAGE_VARIANT', '지원하지 않는 이미지 크기입니다.');
    }
    if (thumbnail && !attachment.mimeType.startsWith('image/')) {
      throw new ApiError(400, 'NOT_AN_IMAGE', '이미지 파일만 썸네일을 사용할 수 있습니다.');
    }
    if (avatar && !canReadProfile) {
      throw new ApiError(404, 'FILE_NOT_FOUND', '프로필 이미지를 찾을 수 없어요.');
    }
    const serveDerivative = thumbnail && !legacyAttachment;
    const variantEtag = thumbnail ? `-thumb-${requestedWidth}` : avatar ? '-avatar-512' : '';
    const etag = `"${attachment.sha256}${variantEtag}"`;
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }

    const objectKey = avatar
      ? `${attachment.storageKey}.avatar-512.webp`
      : serveDerivative
        ? `${attachment.storageKey}.thumb-${requestedWidth}.webp`
        : attachment.storageKey;
    const asciiName = attachment.originalName.replace(/[^A-Za-z0-9._-]/g, '_') || 'download';
    const inline = url.searchParams.get('download') !== '1' && INLINE_MIME_TYPES.has(attachment.mimeType);
    const contentType = serveDerivative || avatar ? 'image/webp' : attachment.mimeType || 'application/octet-stream';
    const disposition = `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`;
    const signedUrl = presignObjectRequest('GET', objectKey, publicStorageOrigin(request), {
      expiresSeconds: 5 * 60,
      query: {
        'response-content-disposition': disposition,
        'response-content-type': contentType,
      },
    });
    return new Response(null, {
      status: 307,
      headers: {
        Location: signedUrl,
        'Cache-Control': 'private, no-store',
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
    const attachment = await prisma.$transaction(async (tx) => {
      const current = await tx.attachment.findUnique({
        where: { id },
        select: {
          id: true,
          uploaderId: true,
          storageKey: true,
          postId: true,
          messageId: true,
          scanStatus: true,
          processingError: true,
          profileForUser: { select: { id: true } },
        },
      });
      if (!current || current.uploaderId !== session.user.id) {
        throw new ApiError(404, 'FILE_NOT_FOUND', '파일을 찾을 수 없어요.');
      }
      assertDeleteEligibleAttachment(current);
      if (current.scanStatus === ATTACHMENT_STATUS.DELETING) return current;
      const claimed = await tx.attachment.updateMany({
        where: {
          id: current.id,
          uploaderId: session.user.id,
          postId: null,
          messageId: null,
          profileForUser: null,
          scanStatus: { not: ATTACHMENT_STATUS.DELETING },
        },
        data: { scanStatus: ATTACHMENT_STATUS.DELETING, processingError: null },
      });
      if (claimed.count !== 1) {
        const raced = await tx.attachment.findUnique({
          where: { id },
          select: { postId: true, messageId: true, profileForUser: { select: { id: true } } },
        });
        if (raced) assertDeleteEligibleAttachment(raced);
        throw new ApiError(409, 'ATTACHMENT_STATE_CONFLICT', '파일 상태가 변경되었습니다. 다시 시도해 주세요.');
      }
      return { ...current, scanStatus: ATTACHMENT_STATUS.DELETING };
    });

    const multipart = parseMultipartUploadMetadata(attachment.processingError);
    if (multipart) {
      await abortMultipartUpload(attachment.storageKey, multipart.uploadId).catch(() => undefined);
    }
    await deleteObjects(attachmentObjectKeys(attachment.storageKey));
    const deleted = await prisma.attachment.deleteMany({
      where: {
        id: attachment.id,
        uploaderId: session.user.id,
        postId: null,
        messageId: null,
        profileForUser: null,
        scanStatus: ATTACHMENT_STATUS.DELETING,
      },
    });
    if (deleted.count !== 1) {
      throw new ApiError(409, 'ATTACHMENT_STATE_CONFLICT', '파일 상태가 변경되었습니다. 다시 시도해 주세요.');
    }
    return json({ deleted: true });
  } catch (error) {
    return jsonError(error);
  }
}
