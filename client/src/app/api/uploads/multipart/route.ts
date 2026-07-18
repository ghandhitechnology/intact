import prisma from '@/lib/prisma';
import {
  ATTACHMENT_STATUS,
  MAX_ATTACHMENT_BYTES,
  MAX_RESOURCE_ATTACHMENT_BYTES,
  normalizeAttachmentMime,
  quarantineStorageKey,
  RESOURCE_UPLOAD_PART_BYTES,
} from '@/lib/server/attachment-state';
import {
  enforceClientIpRateLimit,
  enforceDistributedClientIpRateLimit,
  enforceDistributedRateLimit,
  enforceRateLimit,
  ApiError,
  assertSameOrigin,
  json,
  jsonError,
  readJson,
  requiredInteger,
  requiredString,
} from '@/lib/server/http';
import {
  multipartUploadMetadata,
  resourcePartCount,
  safeAttachmentName,
} from '@/lib/server/multipart-upload';
import { abortMultipartUpload, createMultipartUpload } from '@/lib/server/object-storage';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';

interface MultipartUploadBody {
  board?: unknown;
  name?: unknown;
  size?: unknown;
  mimeType?: unknown;
}

export async function POST(request: Request) {
  let uploadId: string | null = null;
  let storageKey: string | null = null;
  let persisted = false;
  try {
    assertSameOrigin(request);
    enforceClientIpRateLimit(request, 'resource-upload-init', {
      limit: 40,
      windowMs: 60 * 60 * 1_000,
    });
    await enforceDistributedClientIpRateLimit(request, 'resource-upload-init', {
      limit: 40,
      windowMs: 60 * 60 * 1_000,
      failPolicy: 'open',
    });
    const session = await requireUser(request);
    enforceRateLimit(`resource-upload-init:${session.user.id}`, {
      limit: 20,
      windowMs: 60 * 60 * 1_000,
    });
    await enforceDistributedRateLimit(`resource-upload-init:${session.user.id}`, {
      limit: 20,
      windowMs: 60 * 60 * 1_000,
      failPolicy: 'open',
    });

    const body = await readJson<MultipartUploadBody>(request, 8_192);
    const board = requiredString(body.board, '게시판', { max: 64 });
    if (board !== 'resources') {
      throw new ApiError(400, 'RESOURCE_BOARD_REQUIRED', '대용량 파일은 자료공유 게시판에만 올릴 수 있어요.');
    }
    const size = requiredInteger(body.size, '파일 크기', 1, MAX_RESOURCE_ATTACHMENT_BYTES);
    const originalName = safeAttachmentName(requiredString(body.name, '파일 이름', { max: 255 }));
    const mimeType = normalizeAttachmentMime(
      typeof body.mimeType === 'string' ? body.mimeType : 'application/octet-stream',
    );
    if (mimeType.startsWith('image/') && size > MAX_ATTACHMENT_BYTES) {
      throw new ApiError(
        413,
        'IMAGE_TOO_LARGE',
        '이미지는 안전한 재인코딩을 위해 20MB까지, 그 밖의 자료 파일은 500MB까지 가능해요.',
      );
    }

    storageKey = quarantineStorageKey(session.user.id, undefined, undefined, 'resources');
    uploadId = await createMultipartUpload(storageKey, mimeType);
    const metadata = multipartUploadMetadata(uploadId);
    const attachment = await prisma.attachment.create({
      data: {
        uploaderId: session.user.id,
        storageKey,
        originalName,
        mimeType,
        sizeBytes: BigInt(size),
        sha256: '0'.repeat(64),
        scanStatus: ATTACHMENT_STATUS.UPLOADING,
        processingError: JSON.stringify(metadata),
      },
      select: { id: true, originalName: true, mimeType: true, sizeBytes: true, scanStatus: true },
    });
    persisted = true;
    return json({
      attachment: {
        ...attachment,
        sizeBytes: Number(attachment.sizeBytes),
        partSize: RESOURCE_UPLOAD_PART_BYTES,
        partCount: resourcePartCount(attachment.sizeBytes),
        partUrlsEndpoint: `/api/uploads/multipart/${attachment.id}/parts`,
        completeEndpoint: `/api/uploads/multipart/${attachment.id}/complete`,
        statusUrl: `/api/uploads/${attachment.id}/status`,
      },
    }, 201);
  } catch (error) {
    if (uploadId && storageKey && !persisted) {
      await abortMultipartUpload(storageKey, uploadId).catch(() => undefined);
    }
    return jsonError(error);
  }
}
