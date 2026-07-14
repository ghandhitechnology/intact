import prisma from '@/lib/prisma';
import { deleteObject, getObject } from '@/lib/server/object-storage';
import { ApiError, assertSameOrigin, json, jsonError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(request);
    const { id } = await context.params;
    const attachment = await prisma.attachment.findUnique({
      where: { id },
      include: { post: { select: { status: true, authorId: true } } },
    });
    if (!attachment) throw new ApiError(404, 'FILE_NOT_FOUND', '파일을 찾을 수 없어요.');
    if (!attachment.post && attachment.uploaderId !== session.user.id) {
      throw new ApiError(404, 'FILE_NOT_FOUND', '파일을 찾을 수 없어요.');
    }
    if (attachment.post && attachment.post.status !== 'PUBLISHED' && attachment.post.authorId !== session.user.id) {
      throw new ApiError(404, 'FILE_NOT_FOUND', '파일을 찾을 수 없어요.');
    }
    const object = await getObject(attachment.storageKey);
    const body = await object.arrayBuffer();
    const asciiName = attachment.originalName.replace(/[^A-Za-z0-9._-]/g, '_') || 'download';
    return new Response(body, {
      headers: {
        'Content-Type': attachment.mimeType || 'application/octet-stream',
        'Content-Length': String(attachment.sizeBytes),
        'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`,
        'Cache-Control': 'private, no-store',
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
    await deleteObject(attachment.storageKey);
    await prisma.attachment.delete({ where: { id: attachment.id } });
    return json({ deleted: true });
  } catch (error) {
    return jsonError(error);
  }
}
