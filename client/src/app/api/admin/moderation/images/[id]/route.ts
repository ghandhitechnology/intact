import sharp from 'sharp';
import prisma from '@/lib/prisma';
import { getObject } from '@/lib/server/object-storage';
import { ApiError, jsonError } from '@/lib/server/http';
import { requireReadyAdmin } from '@/lib/server/session';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireReadyAdmin(request);
    const { id } = await context.params;
    const attachment = await prisma.attachment.findUnique({ where: { id }, select: { storageKey: true, mimeType: true } });
    if (!attachment?.mimeType.startsWith('image/')) throw new ApiError(404, 'IMAGE_NOT_FOUND', '이미지를 찾을 수 없습니다.');
    const source = await getObject(attachment.storageKey);
    const bytes = Buffer.from(await source.arrayBuffer());
    const sanitized = await sharp(bytes, { animated: false }).rotate().resize({ width: 1280, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    return new Response(new Uint8Array(sanitized), {
      headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (error) {
    return jsonError(error);
  }
}
