import { ApiError } from '@/lib/server/http';

export type VersionedPostSnapshot = {
  id: string;
  version: number;
  updatedAt: Date;
  status: string;
  title: string;
  content: string;
  tags: string[];
  metadata: unknown;
  boardId: string;
};

function parseVersion(value: unknown, field: string) {
  const version = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new ApiError(400, 'INVALID_POST_VERSION', `${field} 값이 올바르지 않습니다.`);
  }
  return version;
}

function parseIfMatch(value: string) {
  const normalized = value.trim().replace(/^W\//i, '').replace(/^"|"$/g, '');
  const match = /^(?:post-[0-9a-f-]+-v|v)?(\d+)$/i.exec(normalized);
  if (!match?.[1]) {
    throw new ApiError(400, 'INVALID_POST_VERSION', 'If-Match 헤더가 올바르지 않습니다.');
  }
  return parseVersion(match[1], 'If-Match');
}

export function requestedPostVersion(request: Request, bodyVersion: unknown) {
  const body = bodyVersion === undefined || bodyVersion === null
    ? null
    : parseVersion(bodyVersion, 'baseVersion');
  const headerValue = request.headers.get('if-match');
  const header = headerValue ? parseIfMatch(headerValue) : null;
  if (body !== null && header !== null && body !== header) {
    throw new ApiError(
      400,
      'POST_VERSION_MISMATCH',
      'baseVersion과 If-Match 헤더가 서로 다릅니다.',
    );
  }
  return body ?? header;
}

export function postVersionEtag(post: { id: string; version: number }) {
  return `"post-${post.id}-v${post.version}"`;
}

export function postConflictDetails(current: VersionedPostSnapshot, baseVersion: number) {
  return {
    recoverable: true,
    baseVersion,
    currentVersion: current.version,
    current: {
      id: current.id,
      version: current.version,
      updatedAt: current.updatedAt.toISOString(),
      status: current.status,
      title: current.title,
      content: current.content,
      tags: current.tags,
      metadata: current.metadata,
      boardId: current.boardId,
    },
  };
}

export function assertPostVersion(current: VersionedPostSnapshot, baseVersion: number) {
  if (current.version === baseVersion) return;
  throw new ApiError(
    409,
    'POST_VERSION_CONFLICT',
    '다른 곳에서 게시글이 수정되었습니다. 현재 내용과 비교한 뒤 다시 저장해 주세요.',
    postConflictDetails(current, baseVersion),
  );
}
