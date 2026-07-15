import type { Prisma } from '@prisma/client';

const PHOTO_MIME_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export function isPhotoMimeType(value: string) {
  return PHOTO_MIME_TYPES.has(value.toLowerCase());
}

export const attachmentSelect = {
  id: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  width: true,
  height: true,
  blurDataUrl: true,
} as const;

export function parseAttachmentIds(value: unknown, maxFiles = 5) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxFiles) return null;
  const ids = Array.from(new Set(value));
  if (ids.some((id) => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id))) {
    return null;
  }
  return ids as string[];
}

export function sanitizePostMetadata(value: unknown): Prisma.InputJsonObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (
    typeof input.deadline === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(input.deadline) &&
    !Number.isNaN(Date.parse(`${input.deadline}T00:00:00+09:00`))
  ) {
    return { deadline: input.deadline };
  }
  return {};
}

export const publicAuthorSelect = {
  id: true,
  nickname: true,
  realName: true,
  profileImage: true,
  role: true,
  level: true,
  studentIdentity: { select: { studentCode: true } },
} as const;

export const postListSelect = {
  id: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  kind: true,
  status: true,
  title: true,
  contentText: true,
  tags: true,
  metadata: true,
  viewCount: true,
  commentCount: true,
  recommendationCount: true,
  bookmarkCount: true,
  isPinned: true,
  isLocked: true,
  acceptedCommentId: true,
  _count: {
    select: {
      attachments: true,
    },
  },
  attachments: {
    where: { scanStatus: 'CLEAN' },
    orderBy: { createdAt: 'asc' as const },
    select: attachmentSelect,
  },
  board: { select: { id: true, slug: true, name: true, kind: true } },
  author: { select: publicAuthorSelect },
} as const;

export const commentSelect = {
  id: true,
  createdAt: true,
  updatedAt: true,
  editedAt: true,
  parentId: true,
  status: true,
  content: true,
  recommendationCount: true,
  author: { select: publicAuthorSelect },
} as const;
