import prisma from '@/lib/prisma';
import { ATTACHMENT_STATUS } from '@/lib/server/attachment-state';
import {
  ApiError,
  assertSameOrigin,
  enforceDistributedRateLimit,
  enforceRateLimit,
  json,
  jsonError,
  readJson,
} from '@/lib/server/http';
import { parseMultipartUploadMetadata, resourcePartCount } from '@/lib/server/multipart-upload';
import {
  completeMultipartUpload,
  deleteObject,
  headObject,
} from '@/lib/server/object-storage';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';

interface CompleteBody {
  parts?: unknown;
}

function completionParts(value: unknown, expectedCount: number) {
  if (!Array.isArray(value) || value.length !== expectedCount) {
    throw new ApiError(400, 'INCOMPLETE_UPLOAD', '파일 조각이 모두 전송되지 않았습니다.');
  }
  const parts = value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ApiError(400, 'INVALID_UPLOAD_PART', '파일 조각 정보가 올바르지 않습니다.');
    }
    const candidate = entry as { partNumber?: unknown; etag?: unknown };
    if (
      typeof candidate.partNumber !== 'number'
      || !Number.isSafeInteger(candidate.partNumber)
      || typeof candidate.etag !== 'string'
      || !/^"?[a-f0-9]{32}(?:-\d+)?"?$/i.test(candidate.etag)
    ) {
      throw new ApiError(400, 'INVALID_UPLOAD_PART', '파일 조각 정보가 올바르지 않습니다.');
    }
    return { partNumber: Number(candidate.partNumber), etag: candidate.etag };
  }).sort((left, right) => left.partNumber - right.partNumber);
  if (parts.some((part, index) => part.partNumber !== index + 1)) {
    throw new ApiError(400, 'INCOMPLETE_UPLOAD', '파일 조각 순서가 올바르지 않습니다.');
  }
  return parts;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    enforceRateLimit(`resource-upload-complete:${session.user.id}`, {
      limit: 100,
      windowMs: 60 * 60 * 1_000,
    });
    await enforceDistributedRateLimit(`resource-upload-complete:${session.user.id}`, {
      limit: 100,
      windowMs: 60 * 60 * 1_000,
      failPolicy: 'open',
    });
    const { id } = await context.params;
    const attachment = await prisma.attachment.findUnique({
      where: { id },
      select: {
        id: true,
        uploaderId: true,
        storageKey: true,
        sizeBytes: true,
        scanStatus: true,
        processingError: true,
      },
    });
    if (!attachment || attachment.uploaderId !== session.user.id) {
      throw new ApiError(404, 'FILE_NOT_FOUND', '파일 업로드를 찾을 수 없어요.');
    }
    if (
      attachment.scanStatus === ATTACHMENT_STATUS.PENDING
      || attachment.scanStatus === ATTACHMENT_STATUS.PROCESSING
      || attachment.scanStatus === ATTACHMENT_STATUS.CLEAN
    ) {
      return json({
        attachment: {
          id: attachment.id,
          scanStatus: attachment.scanStatus,
          statusUrl: `/api/uploads/${attachment.id}/status`,
        },
      }, 202);
    }
    if (attachment.scanStatus !== ATTACHMENT_STATUS.UPLOADING) {
      throw new ApiError(409, 'UPLOAD_NOT_ACTIVE', '이미 취소되었거나 처리할 수 없는 파일 업로드예요.');
    }
    const metadata = parseMultipartUploadMetadata(attachment.processingError);
    if (!metadata) throw new ApiError(409, 'UPLOAD_STATE_INVALID', '파일 업로드 상태를 복구할 수 없어요.');
    const body = await readJson<CompleteBody>(request, 32_768);
    const parts = completionParts(body.parts, resourcePartCount(attachment.sizeBytes));

    try {
      await completeMultipartUpload(attachment.storageKey, metadata.uploadId, parts);
    } catch {
      // A client retry can arrive after MinIO committed the object but before
      // the database transition completed. HEAD makes finalization idempotent.
      const existing = await headObject(attachment.storageKey).catch(() => null);
      if (!existing || BigInt(existing.size) !== attachment.sizeBytes) {
        throw new ApiError(502, 'UPLOAD_FINALIZE_FAILED', '파일 결합에 실패했습니다. 잠시 후 다시 시도해 주세요.');
      }
    }

    const stored = await headObject(attachment.storageKey);
    if (BigInt(stored.size) !== attachment.sizeBytes) {
      await deleteObject(attachment.storageKey).catch(() => undefined);
      await prisma.attachment.updateMany({
        where: { id: attachment.id, uploaderId: session.user.id },
        data: {
          scanStatus: ATTACHMENT_STATUS.REJECTED,
          processingError: JSON.stringify({ error: 'Uploaded file size did not match the declared size.' }),
          finalizedAt: new Date(),
        },
      });
      throw new ApiError(400, 'UPLOAD_SIZE_MISMATCH', '전송된 파일 크기가 원본과 달라 다시 올려야 합니다.');
    }

    const transitioned = await prisma.attachment.updateMany({
      where: {
        id: attachment.id,
        uploaderId: session.user.id,
        scanStatus: ATTACHMENT_STATUS.UPLOADING,
      },
      data: {
        scanStatus: ATTACHMENT_STATUS.PENDING,
        processingError: null,
        finalizedAt: null,
      },
    });
    if (transitioned.count !== 1) {
      const current = await prisma.attachment.findUnique({
        where: { id: attachment.id },
        select: { scanStatus: true },
      });
      if (
        current?.scanStatus === ATTACHMENT_STATUS.PENDING
        || current?.scanStatus === ATTACHMENT_STATUS.PROCESSING
        || current?.scanStatus === ATTACHMENT_STATUS.CLEAN
      ) {
        return json({
          attachment: {
            id: attachment.id,
            scanStatus: current.scanStatus,
            statusUrl: `/api/uploads/${attachment.id}/status`,
          },
        }, 202);
      }
      throw new ApiError(409, 'UPLOAD_STATE_CONFLICT', '파일 상태가 변경되었습니다. 상태를 다시 확인해 주세요.');
    }
    return json({
      attachment: {
        id: attachment.id,
        scanStatus: ATTACHMENT_STATUS.PENDING,
        statusUrl: `/api/uploads/${attachment.id}/status`,
      },
    }, 202);
  } catch (error) {
    return jsonError(error);
  }
}
