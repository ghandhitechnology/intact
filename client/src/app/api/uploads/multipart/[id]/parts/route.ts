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
import {
  MULTIPART_URL_BATCH_SIZE,
  MULTIPART_URL_EXPIRES_SECONDS,
  parseMultipartUploadMetadata,
  publicStorageOrigin,
  resourcePartCount,
} from '@/lib/server/multipart-upload';
import { presignMultipartPart } from '@/lib/server/object-storage';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';

interface PartUrlsBody {
  partNumbers?: unknown;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    enforceRateLimit(`resource-upload-parts:${session.user.id}`, {
      limit: 600,
      windowMs: 60 * 60 * 1_000,
    });
    await enforceDistributedRateLimit(`resource-upload-parts:${session.user.id}`, {
      limit: 600,
      windowMs: 60 * 60 * 1_000,
      failPolicy: 'open',
    });
    const { id } = await context.params;
    const body = await readJson<PartUrlsBody>(request, 8_192);
    if (!Array.isArray(body.partNumbers) || body.partNumbers.length < 1 || body.partNumbers.length > MULTIPART_URL_BATCH_SIZE) {
      throw new ApiError(400, 'INVALID_PART_NUMBERS', `한 번에 1~${MULTIPART_URL_BATCH_SIZE}개 조각을 요청해 주세요.`);
    }
    const partNumbers = Array.from(new Set(body.partNumbers));
    if (
      partNumbers.length !== body.partNumbers.length
      || partNumbers.some((value) => typeof value !== 'number' || !Number.isSafeInteger(value))
    ) {
      throw new ApiError(400, 'INVALID_PART_NUMBERS', '파일 조각 번호가 올바르지 않습니다.');
    }
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
    if (attachment.scanStatus !== ATTACHMENT_STATUS.UPLOADING) {
      throw new ApiError(409, 'UPLOAD_NOT_ACTIVE', '이미 완료되었거나 취소된 파일 업로드예요.');
    }
    const metadata = parseMultipartUploadMetadata(attachment.processingError);
    if (!metadata) throw new ApiError(409, 'UPLOAD_STATE_INVALID', '파일 업로드 상태를 복구할 수 없어요.');
    const count = resourcePartCount(attachment.sizeBytes);
    const validatedPartNumbers = partNumbers as number[];
    if (validatedPartNumbers.some((value) => value < 1 || value > count)) {
      throw new ApiError(400, 'INVALID_PART_NUMBERS', '파일 조각 번호가 허용 범위를 벗어났습니다.');
    }
    const endpoint = publicStorageOrigin(request);
    return json({
      expiresInSeconds: MULTIPART_URL_EXPIRES_SECONDS,
      parts: validatedPartNumbers.map((partNumber) => {
        return {
          partNumber,
          url: presignMultipartPart(
            attachment.storageKey,
            metadata.uploadId,
            partNumber,
            endpoint,
            MULTIPART_URL_EXPIRES_SECONDS,
          ),
        };
      }),
    });
  } catch (error) {
    return jsonError(error);
  }
}
