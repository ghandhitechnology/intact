import { createHash, randomUUID } from 'crypto';
import prisma from '@/lib/prisma';
import { deleteObject, putObject } from '@/lib/server/object-storage';
import {
  ApiError,
  assertSameOrigin,
  enforceClientIpRateLimit,
  enforceRateLimit,
  json,
  jsonError,
} from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';

const MAX_FILE_SIZE = 20 * 1024 * 1024;

function safeName(value: string) {
  const name = value.normalize('NFKC').split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (name || '첨부파일').slice(0, 255);
}

export async function POST(request: Request) {
  let storedKey: string | null = null;
  try {
    assertSameOrigin(request);
    enforceClientIpRateLimit(request, 'file-upload', { limit: 80, windowMs: 60 * 60 * 1_000 });
    const session = await requireUser(request);
    enforceRateLimit(`file-upload:${session.user.id}`, { limit: 40, windowMs: 60 * 60 * 1_000 });
    const declaredSize = Number(request.headers.get('content-length') || 0);
    if (declaredSize > MAX_FILE_SIZE + 1024 * 1024) {
      throw new ApiError(413, 'FILE_TOO_LARGE', '파일은 하나당 20MB까지 올릴 수 있어요.');
    }
    const form = await request.formData();
    const value = form.get('file');
    if (!value || typeof value === 'string') {
      throw new ApiError(400, 'FILE_REQUIRED', '올릴 파일을 선택해 주세요.');
    }
    if (value.size < 1 || value.size > MAX_FILE_SIZE) {
      throw new ApiError(413, 'FILE_TOO_LARGE', '빈 파일은 올릴 수 없고, 파일은 하나당 20MB까지 가능해요.');
    }
    const originalName = safeName(value.name);
    const mimeType = (value.type || 'application/octet-stream').slice(0, 127);
    const bytes = new Uint8Array(await value.arrayBuffer());
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    storedKey = `${date}/${session.user.id}/${randomUUID()}`;
    await putObject(storedKey, bytes, mimeType);
    const attachment = await prisma.attachment.create({
      data: {
        uploaderId: session.user.id,
        storageKey: storedKey,
        originalName,
        mimeType,
        sizeBytes: BigInt(value.size),
        sha256,
        scanStatus: 'CLEAN',
      },
      select: { id: true, originalName: true, mimeType: true, sizeBytes: true },
    });
    return json({
      attachment: {
        ...attachment,
        sizeBytes: Number(attachment.sizeBytes),
      },
    }, 201);
  } catch (error) {
    if (storedKey) await deleteObject(storedKey).catch(() => undefined);
    return jsonError(error);
  }
}
