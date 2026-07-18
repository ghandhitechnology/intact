import {
  MAX_ATTACHMENT_BYTES,
  MAX_RESOURCE_ATTACHMENT_BYTES,
  RESOURCE_UPLOAD_PART_BYTES,
} from './attachment-state';
import { ApiError } from './http';

export const MULTIPART_UPLOAD_EXPIRES_MS = 24 * 60 * 60 * 1_000;
export const MULTIPART_URL_EXPIRES_SECONDS = 15 * 60;
export const MULTIPART_URL_BATCH_SIZE = 6;

export interface MultipartUploadMetadata {
  uploadId: string;
  partSize: number;
  initiatedAt: string;
}

export function safeAttachmentName(value: string) {
  const name = value
    .normalize('NFKC')
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return (name || '첨부파일').slice(0, 255);
}

export function multipartUploadMetadata(uploadId: string, now = new Date()): MultipartUploadMetadata {
  if (!uploadId || uploadId.length > 700 || /[\u0000-\u001f\u007f]/.test(uploadId)) {
    throw new Error('Object storage returned an invalid multipart upload ID.');
  }
  return {
    uploadId,
    partSize: RESOURCE_UPLOAD_PART_BYTES,
    initiatedAt: now.toISOString(),
  };
}

export function parseMultipartUploadMetadata(raw: string | null): MultipartUploadMetadata | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<MultipartUploadMetadata>;
    if (
      typeof value.uploadId !== 'string'
      || !value.uploadId
      || value.uploadId.length > 700
      || /[\u0000-\u001f\u007f]/.test(value.uploadId)
      || value.partSize !== RESOURCE_UPLOAD_PART_BYTES
      || typeof value.initiatedAt !== 'string'
      || !Number.isFinite(Date.parse(value.initiatedAt))
    ) return null;
    return value as MultipartUploadMetadata;
  } catch {
    return null;
  }
}

export function resourcePartCount(sizeBytes: number | bigint) {
  const size = Number(sizeBytes);
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_RESOURCE_ATTACHMENT_BYTES) {
    throw new ApiError(400, 'INVALID_UPLOAD_SIZE', '자료 파일 크기가 올바르지 않습니다.');
  }
  return Math.ceil(size / RESOURCE_UPLOAD_PART_BYTES);
}

export function isResourceStorageKey(storageKey: string) {
  return storageKey.startsWith('quarantine/resources/') || storageKey.startsWith('clean/resources/');
}

export function assertAttachmentAllowedOnBoard(
  boardSlug: string,
  attachments: Array<{ storageKey: string; sizeBytes: bigint | number }>,
) {
  const resourceOnly = attachments.some((attachment) =>
    isResourceStorageKey(attachment.storageKey)
    || BigInt(attachment.sizeBytes) > BigInt(MAX_ATTACHMENT_BYTES));
  if (resourceOnly && boardSlug !== 'resources') {
    throw new ApiError(
      400,
      'RESOURCE_ATTACHMENT_BOARD_REQUIRED',
      '20MB를 넘는 자료 파일은 자료공유 게시판에만 올릴 수 있어요.',
    );
  }
}

export function publicStorageOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  let origin = new URL(request.url).origin;
  if (configured) {
    try {
      origin = new URL(configured).origin;
    } catch {
      throw new ApiError(500, 'INVALID_APP_ORIGIN', '서비스 공개 주소 설정이 올바르지 않습니다.');
    }
  }
  const url = new URL(origin);
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new ApiError(500, 'INSECURE_UPLOAD_ORIGIN', '운영 파일 전송 주소는 HTTPS여야 합니다.');
  }
  return url;
}
