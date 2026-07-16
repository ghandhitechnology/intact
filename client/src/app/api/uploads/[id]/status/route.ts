import prisma from '@/lib/prisma';
import { ATTACHMENT_STATUS, isTerminalAttachmentStatus } from '@/lib/server/attachment-state';
import { ApiError, json, jsonError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';

function publicProcessingError(status: string, raw: string | null) {
  if (
    !raw
    || (status !== ATTACHMENT_STATUS.REJECTED && status !== ATTACHMENT_STATUS.FAILED)
  ) return null;
  try {
    const parsed = JSON.parse(raw) as { error?: unknown };
    return typeof parsed.error === 'string' ? parsed.error.slice(0, 300) : null;
  } catch {
    return raw.slice(0, 300);
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(request);
    const { id } = await context.params;
    const attachment = await prisma.attachment.findUnique({
      where: { id },
      select: {
        id: true,
        uploaderId: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        width: true,
        height: true,
        blurDataUrl: true,
        scanStatus: true,
        processingError: true,
        finalizedAt: true,
      },
    });
    if (!attachment || attachment.uploaderId !== session.user.id) {
      throw new ApiError(404, 'FILE_NOT_FOUND', '파일을 찾을 수 없어요.');
    }
    return json({
      attachment: {
        id: attachment.id,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        sizeBytes: Number(attachment.sizeBytes),
        width: attachment.width,
        height: attachment.height,
        blurDataUrl: attachment.blurDataUrl,
        scanStatus: attachment.scanStatus,
        ready: attachment.scanStatus === ATTACHMENT_STATUS.CLEAN,
        terminal: isTerminalAttachmentStatus(attachment.scanStatus),
        finalizedAt: attachment.finalizedAt?.toISOString() || null,
        processingError: publicProcessingError(attachment.scanStatus, attachment.processingError),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
