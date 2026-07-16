import prisma from '@/lib/prisma';
import { deleteObject, putObject } from '@/lib/server/object-storage';
import {
  ATTACHMENT_STATUS,
  AttachmentValidationError,
  MAX_ATTACHMENT_BYTES,
  quarantineStorageKey,
  validateAttachmentBytes,
} from '@/lib/server/attachment-state';
import {
  ApiError,
  assertSameOrigin,
  enforceClientIpRateLimit,
  enforceDistributedRateLimit,
  enforceRateLimit,
  json,
  jsonError,
} from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';

function safeName(value: string) {
  const name = value.normalize('NFKC').split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (name || '첨부파일').slice(0, 255);
}

function uploadValidationError(error: AttachmentValidationError): ApiError {
  if (error.code === 'FILE_TOO_LARGE') {
    return new ApiError(413, error.code, '빈 파일은 올릴 수 없고, 파일은 하나당 20MB까지 가능해요.');
  }
  if (error.code === 'INVALID_IMAGE') {
    return new ApiError(400, error.code, '이미지 파일이 손상되었거나 안전하게 처리할 수 없어요.');
  }
  return new ApiError(400, error.code, '파일 확장자, 형식, 내용을 다시 확인해 주세요.');
}

export async function POST(request: Request) {
  let storedKey: string | null = null;
  let persisted = false;
  try {
    assertSameOrigin(request);
    enforceClientIpRateLimit(request, 'file-upload', { limit: 80, windowMs: 60 * 60 * 1_000 });
    const session = await requireUser(request);
    enforceRateLimit(`file-upload:${session.user.id}`, { limit: 40, windowMs: 60 * 60 * 1_000 });
    await enforceDistributedRateLimit(`file-upload:${session.user.id}`, {
      limit: 40,
      windowMs: 60 * 60 * 1_000,
      failPolicy: 'open',
    });
    const declaredSize = Number(request.headers.get('content-length') || 0);
    if (declaredSize > MAX_ATTACHMENT_BYTES + 1024 * 1024) {
      throw new ApiError(413, 'FILE_TOO_LARGE', '파일은 하나당 20MB까지 올릴 수 있어요.');
    }

    const form = await request.formData();
    const value = form.get('file');
    if (!value || typeof value === 'string') {
      throw new ApiError(400, 'FILE_REQUIRED', '올릴 파일을 선택해 주세요.');
    }
    if (value.size < 1 || value.size > MAX_ATTACHMENT_BYTES) {
      throw new ApiError(413, 'FILE_TOO_LARGE', '빈 파일은 올릴 수 없고, 파일은 하나당 20MB까지 가능해요.');
    }

    const bytes = new Uint8Array(await value.arrayBuffer());
    let validation;
    try {
      validation = await validateAttachmentBytes({
        bytes,
        declaredMimeType: value.type || 'application/octet-stream',
        expectedSize: value.size,
      });
    } catch (error) {
      if (error instanceof AttachmentValidationError) throw uploadValidationError(error);
      throw error;
    }

    storedKey = quarantineStorageKey(session.user.id);
    await putObject(storedKey, bytes, validation.mimeType);
    const attachment = await prisma.attachment.create({
      data: {
        uploaderId: session.user.id,
        storageKey: storedKey,
        originalName: safeName(value.name),
        mimeType: validation.mimeType,
        sizeBytes: BigInt(bytes.byteLength),
        sha256: validation.sha256,
        scanStatus: ATTACHMENT_STATUS.PENDING,
        width: validation.width,
        height: validation.height,
        blurDataUrl: null,
      },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        width: true,
        height: true,
        blurDataUrl: true,
        scanStatus: true,
      },
    });
    persisted = true;
    return json({
      attachment: {
        ...attachment,
        sizeBytes: Number(attachment.sizeBytes),
        statusUrl: `/api/uploads/${attachment.id}/status`,
      },
    }, 201);
  } catch (error) {
    if (storedKey && !persisted) await deleteObject(storedKey).catch(() => undefined);
    return jsonError(error);
  }
}
