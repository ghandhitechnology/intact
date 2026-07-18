import sharp from 'sharp';
import prisma from '@/lib/prisma';
import { attachmentObjectKeys, ATTACHMENT_STATUS } from '@/lib/server/attachment-state';
import { deleteObjects, getObject, putObject } from '@/lib/server/object-storage';
import {
  ApiError,
  assertSameOrigin,
  enforceRateLimit,
  json,
  jsonError,
  readJson,
} from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';

const PROFILE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const PROFILE_IMAGE_TYPES = new Set(['image/avif', 'image/jpeg', 'image/png', 'image/webp']);

async function deleteDetachedProfileImage(attachment: {
  id: string;
  storageKey: string;
  uploaderId: string;
} | null) {
  if (!attachment) return;
  const removed = await prisma.attachment.deleteMany({
    where: {
      id: attachment.id,
      uploaderId: attachment.uploaderId,
      postId: null,
      messageId: null,
      profileForUser: null,
    },
  });
  if (removed.count === 1) await deleteObjects(attachmentObjectKeys(attachment.storageKey));
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    enforceRateLimit(`profile-avatar:${session.user.id}`, {
      limit: 10,
      windowMs: 24 * 60 * 60_000,
    });
    const body = await readJson<{ attachmentId?: unknown }>(request, 4_096);
    const attachmentId = body.attachmentId === null
      ? null
      : typeof body.attachmentId === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(body.attachmentId)
        ? body.attachmentId
        : undefined;
    if (attachmentId === undefined) {
      throw new ApiError(400, 'INVALID_PROFILE_IMAGE', '프로필 이미지를 다시 선택해 주세요.');
    }

    const before = await prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: {
        profileImageAttachment: { select: { id: true, storageKey: true, uploaderId: true } },
      },
    });
    if (attachmentId === null) {
      const profile = await prisma.user.update({
        where: { id: session.user.id },
        data: { profileImageAttachmentId: null, profileImage: null },
        select: { id: true },
      });
      await deleteDetachedProfileImage(before.profileImageAttachment).catch(() => undefined);
      return json({ profile: { ...profile, profileImage: null } });
    }

    const attachment = await prisma.attachment.findUnique({
      where: { id: attachmentId },
      select: {
        id: true,
        uploaderId: true,
        storageKey: true,
        mimeType: true,
        sizeBytes: true,
        scanStatus: true,
        finalizedAt: true,
        postId: true,
        messageId: true,
        profileForUser: { select: { id: true } },
      },
    });
    if (
      !attachment
      || attachment.uploaderId !== session.user.id
      || attachment.scanStatus !== ATTACHMENT_STATUS.CLEAN
      || !attachment.finalizedAt
      || attachment.postId
      || attachment.messageId
      || attachment.profileForUser
    ) {
      throw new ApiError(409, 'PROFILE_IMAGE_NOT_READY', '이미지 안전 검사가 끝난 뒤 다시 저장해 주세요.');
    }
    if (attachment.sizeBytes > BigInt(PROFILE_IMAGE_MAX_BYTES) || !PROFILE_IMAGE_TYPES.has(attachment.mimeType)) {
      throw new ApiError(400, 'INVALID_PROFILE_IMAGE', '10MB 이하의 JPEG, PNG, WebP 또는 AVIF 이미지만 사용할 수 있습니다.');
    }

    const response = await getObject(attachment.storageKey);
    const source = Buffer.from(await response.arrayBuffer());
    const avatar = await sharp(source, {
      animated: false,
      failOn: 'error',
      limitInputPixels: 40_000_000,
    })
      .rotate()
      .resize(512, 512, { fit: 'cover', position: 'centre' })
      .webp({ quality: 84, effort: 5 })
      .toBuffer();
    await putObject(`${attachment.storageKey}.avatar-512.webp`, avatar, 'image/webp');

    await prisma.user.update({
      where: { id: session.user.id },
      data: { profileImageAttachmentId: attachment.id, profileImage: null },
    });
    if (before.profileImageAttachment?.id !== attachment.id) {
      await deleteDetachedProfileImage(before.profileImageAttachment).catch(() => undefined);
    }
    return json({
      profile: {
        id: session.user.id,
        profileImage: `/api/uploads/${encodeURIComponent(attachment.id)}?variant=avatar`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
