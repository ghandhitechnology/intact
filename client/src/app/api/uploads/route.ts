import { createHash, randomUUID } from 'crypto';
import sharp from 'sharp';
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

function detectedImageMime(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return 'image/png';
  const signature = new TextDecoder('ascii').decode(bytes.slice(0, 16));
  if (signature.startsWith('GIF87a') || signature.startsWith('GIF89a')) return 'image/gif';
  if (signature.startsWith('RIFF') && signature.slice(8, 12) === 'WEBP') return 'image/webp';
  if (signature.slice(4, 8) === 'ftyp' && ['avif', 'avis'].includes(signature.slice(8, 12))) return 'image/avif';
  return null;
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
    const bytes = new Uint8Array(await value.arrayBuffer());
    const declaredMimeType = (value.type || 'application/octet-stream').slice(0, 127).toLowerCase();
    const detectedMimeType = detectedImageMime(bytes);
    if (declaredMimeType.startsWith('image/') && !detectedMimeType) {
      throw new ApiError(400, 'INVALID_IMAGE', '이미지 파일 형식을 확인할 수 없어요. JPG, PNG, GIF, WebP, AVIF를 사용해 주세요.');
    }
    const mimeType = detectedMimeType || declaredMimeType;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    storedKey = `${date}/${session.user.id}/${randomUUID()}`;
    await putObject(storedKey, bytes, mimeType);
    let width: number | null = null;
    let height: number | null = null;
    let blurDataUrl: string | null = null;
    if (detectedMimeType) {
      const image = sharp(bytes, { animated: false }).rotate();
      const metadata = await image.metadata();
      width = metadata.width ?? null;
      height = metadata.height ?? null;
      const blur = await image.clone().resize({ width: 24, withoutEnlargement: true }).webp({ quality: 45 }).toBuffer();
      blurDataUrl = `data:image/webp;base64,${blur.toString('base64')}`;
    }
    const attachment = await prisma.attachment.create({
      data: {
        uploaderId: session.user.id,
        storageKey: storedKey,
        originalName,
        mimeType,
        sizeBytes: BigInt(value.size),
        sha256,
        scanStatus: 'CLEAN',
        width,
        height,
        blurDataUrl,
      },
      select: { id: true, originalName: true, mimeType: true, sizeBytes: true, width: true, height: true, blurDataUrl: true },
    });
    if (detectedMimeType) {
      const derivativeBaseKey = storedKey;
      void Promise.all([320, 640, 1280].map(async (targetWidth) => {
        const derivative = await sharp(bytes, { animated: false })
          .rotate()
          .resize({ width: targetWidth, withoutEnlargement: true })
          .webp({ quality: 78 })
          .toBuffer();
        await putObject(`${derivativeBaseKey}.thumb-${targetWidth}.webp`, derivative, 'image/webp');
      })).catch(() => undefined);
    }
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
