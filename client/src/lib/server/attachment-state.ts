import { createHash, randomUUID } from 'crypto';
import net from 'net';
import sharp from 'sharp';
import type { Prisma } from '@prisma/client';
import { ApiError } from './http';

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_RESOURCE_ATTACHMENT_BYTES = 500 * 1024 * 1024;
export const RESOURCE_UPLOAD_PART_BYTES = 8 * 1024 * 1024;
export const ATTACHMENT_DERIVATIVE_WIDTHS = [320, 640, 1280] as const;

export const ATTACHMENT_STATUS = {
  UPLOADING: 'UPLOADING',
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  CLEAN: 'CLEAN',
  INFECTED: 'INFECTED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
  DELETING: 'DELETING',
} as const;

export type AttachmentStatus = typeof ATTACHMENT_STATUS[keyof typeof ATTACHMENT_STATUS];

const TERMINAL_STATUSES = new Set<AttachmentStatus>([
  ATTACHMENT_STATUS.CLEAN,
  ATTACHMENT_STATUS.INFECTED,
  ATTACHMENT_STATUS.REJECTED,
  ATTACHMENT_STATUS.FAILED,
]);

const TRANSITIONS: Record<AttachmentStatus, ReadonlySet<AttachmentStatus>> = {
  UPLOADING: new Set([ATTACHMENT_STATUS.PENDING, ATTACHMENT_STATUS.REJECTED, ATTACHMENT_STATUS.DELETING]),
  PENDING: new Set([ATTACHMENT_STATUS.PROCESSING, ATTACHMENT_STATUS.DELETING]),
  PROCESSING: new Set([
    ATTACHMENT_STATUS.PENDING,
    ATTACHMENT_STATUS.CLEAN,
    ATTACHMENT_STATUS.INFECTED,
    ATTACHMENT_STATUS.REJECTED,
    ATTACHMENT_STATUS.FAILED,
    ATTACHMENT_STATUS.DELETING,
  ]),
  CLEAN: new Set([ATTACHMENT_STATUS.DELETING]),
  INFECTED: new Set([ATTACHMENT_STATUS.DELETING]),
  REJECTED: new Set([ATTACHMENT_STATUS.DELETING]),
  FAILED: new Set([ATTACHMENT_STATUS.PENDING, ATTACHMENT_STATUS.DELETING]),
  DELETING: new Set(),
};

export class AttachmentValidationError extends Error {
  constructor(
    public readonly code: 'FILE_TOO_LARGE' | 'MIME_MISMATCH' | 'INVALID_IMAGE' | 'CHECKSUM_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'AttachmentValidationError';
  }
}

export function canTransitionAttachment(from: string, to: AttachmentStatus) {
  return from in TRANSITIONS && TRANSITIONS[from as AttachmentStatus].has(to);
}

export function isTerminalAttachmentStatus(status: string): status is AttachmentStatus {
  return TERMINAL_STATUSES.has(status as AttachmentStatus);
}

export function isBindEligibleAttachment(attachment: {
  scanStatus: string;
  storageKey: string;
  finalizedAt?: Date | null;
}) {
  return attachment.scanStatus === ATTACHMENT_STATUS.CLEAN
    && attachment.storageKey.startsWith('clean/')
    && attachment.finalizedAt != null;
}

export function isLegacyReadableAttachment(attachment: {
  scanStatus: string;
  storageKey: string;
  finalizedAt?: Date | null;
}) {
  return attachment.scanStatus === ATTACHMENT_STATUS.CLEAN
    && attachment.finalizedAt == null
    && !attachment.storageKey.startsWith('clean/')
    && !attachment.storageKey.startsWith('quarantine/');
}

export function isReadableAttachment(attachment: {
  scanStatus: string;
  storageKey: string;
  finalizedAt?: Date | null;
}) {
  return isBindEligibleAttachment(attachment) || isLegacyReadableAttachment(attachment);
}

export function assertDeleteEligibleAttachment(attachment: {
  postId: string | null;
  messageId: string | null;
}) {
  if (attachment.postId || attachment.messageId) {
    throw new ApiError(409, 'ATTACHMENT_BOUND', '게시물이나 메시지에 연결된 파일은 직접 삭제할 수 없어요.');
  }
}

export async function bindEligibleAttachments(
  tx: Prisma.TransactionClient,
  input: {
    attachmentIds: string[];
    uploaderId: string;
    binding: { postId: string } | { messageId: string };
  },
) {
  if (input.attachmentIds.length === 0) return;
  const attached = await tx.attachment.updateMany({
    where: {
      id: { in: input.attachmentIds },
      uploaderId: input.uploaderId,
      postId: null,
      messageId: null,
      scanStatus: ATTACHMENT_STATUS.CLEAN,
      finalizedAt: { not: null },
      storageKey: { startsWith: 'clean/' },
    },
    data: input.binding,
  });
  if (attached.count !== input.attachmentIds.length) {
    throw new ApiError(409, 'ATTACHMENTS_NOT_READY', '첨부 파일 검사가 끝날 때까지 잠시 기다려 주세요.');
  }
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0) {
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return Buffer.from(bytes.subarray(start, end)).toString('ascii');
}

export function detectAttachmentMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (bytes.length >= 8 && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))) return 'image/gif';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    if (['avif', 'avis'].includes(brand)) return 'image/avif';
    if (['isom', 'iso2', 'mp41', 'mp42', 'M4V ', 'M4A '].includes(brand)) return 'video/mp4';
  }
  if (bytes.length >= 5 && ascii(bytes, 0, 5) === '%PDF-') return 'application/pdf';
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === 'OggS') return 'audio/ogg';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WAVE') return 'audio/wav';
  if (bytes.length >= 3 && ascii(bytes, 0, 3) === 'ID3') return 'audio/mpeg';
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return 'audio/mpeg';
  if (bytes.length >= 4 && startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  if (bytes.length >= 4 && (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]))) {
    return 'application/zip';
  }
  return null;
}

const MAGIC_REQUIRED = new Set([
  'application/pdf',
  'application/zip',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'video/mp4',
  'video/webm',
]);

// These formats are ZIP containers. Keep their declared document type after
// confirming the container signature so downloads do not become generic ZIPs.
const ZIP_CONTAINER_MIME_TYPES = new Set([
  'application/epub+zip',
  'application/java-archive',
  'application/vnd.hancom.hwpx',
  'application/vnd.oasis.opendocument.graphics',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  'application/vnd.openxmlformats-officedocument.presentationml.template',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  'application/vnd.ms-excel.addin.macroenabled.12',
  'application/vnd.ms-excel.sheet.binary.macroenabled.12',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.ms-excel.template.macroenabled.12',
  'application/vnd.ms-powerpoint.addin.macroenabled.12',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12',
  'application/vnd.ms-powerpoint.slideshow.macroenabled.12',
  'application/vnd.ms-powerpoint.template.macroenabled.12',
  'application/vnd.ms-word.document.macroenabled.12',
  'application/vnd.ms-word.template.macroenabled.12',
]);

export function normalizeAttachmentMime(value: string) {
  const normalized = value.split(';', 1)[0]!.trim().toLowerCase().slice(0, 127);
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/.test(normalized)
    ? normalized
    : 'application/octet-stream';
}

export function validateAttachmentMetadata(input: {
  prefix: Uint8Array;
  declaredMimeType: string;
  actualSize: number | bigint;
  expectedSize?: number | bigint;
  maxBytes?: number;
}) {
  const actualSize = BigInt(input.actualSize);
  const maxBytes = BigInt(input.maxBytes ?? MAX_ATTACHMENT_BYTES);
  if (actualSize < BigInt(1) || actualSize > maxBytes) {
    throw new AttachmentValidationError('FILE_TOO_LARGE', '파일 크기가 허용 범위를 벗어났습니다.');
  }
  if (input.expectedSize != null && actualSize !== BigInt(input.expectedSize)) {
    throw new AttachmentValidationError('CHECKSUM_MISMATCH', '저장된 파일 크기가 업로드 정보와 다릅니다.');
  }
  const declaredMimeType = normalizeAttachmentMime(input.declaredMimeType);
  const detectedMimeType = detectAttachmentMime(input.prefix);
  const requiresMagic = declaredMimeType.startsWith('image/') || MAGIC_REQUIRED.has(declaredMimeType);
  if (requiresMagic && !detectedMimeType) {
    throw new AttachmentValidationError('MIME_MISMATCH', '선언된 파일 형식과 실제 내용이 다릅니다.');
  }
  if (
    detectedMimeType
    && declaredMimeType !== 'application/octet-stream'
    && detectedMimeType !== declaredMimeType
    && !(detectedMimeType === 'application/zip' && ZIP_CONTAINER_MIME_TYPES.has(declaredMimeType))
  ) {
    throw new AttachmentValidationError('MIME_MISMATCH', '선언된 파일 형식과 실제 내용이 다릅니다.');
  }
  return {
    mimeType: declaredMimeType === 'application/octet-stream'
      ? (detectedMimeType || declaredMimeType)
      : declaredMimeType,
  };
}

export async function validateAttachmentBytes(input: {
  bytes: Uint8Array;
  declaredMimeType: string;
  expectedSize?: number | bigint;
  expectedSha256?: string;
}) {
  const { bytes } = input;
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentValidationError('FILE_TOO_LARGE', '파일 크기가 허용 범위를 벗어났습니다.');
  }
  if (input.expectedSize != null && BigInt(bytes.byteLength) !== BigInt(input.expectedSize)) {
    throw new AttachmentValidationError('CHECKSUM_MISMATCH', '저장된 파일 크기가 업로드 정보와 다릅니다.');
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (input.expectedSha256 && sha256 !== input.expectedSha256.toLowerCase()) {
    throw new AttachmentValidationError('CHECKSUM_MISMATCH', '저장된 파일 체크섬이 업로드 정보와 다릅니다.');
  }

  const { mimeType } = validateAttachmentMetadata({
    prefix: bytes,
    declaredMimeType: input.declaredMimeType,
    actualSize: bytes.byteLength,
    expectedSize: input.expectedSize,
  });

  let width: number | null = null;
  let height: number | null = null;
  if (mimeType.startsWith('image/')) {
    try {
      const image = sharp(bytes, { animated: true, failOn: 'error', limitInputPixels: 40_000_000 });
      const metadata = await image.metadata();
      await image.stats();
      if (!metadata.width || !metadata.height) throw new Error('Image dimensions are missing.');
      width = metadata.width;
      height = metadata.pageHeight || metadata.height;
    } catch {
      throw new AttachmentValidationError('INVALID_IMAGE', '이미지 파일이 손상되었거나 안전하게 처리할 수 없습니다.');
    }
  }
  return { sha256, mimeType, width, height };
}

export function quarantineStorageKey(
  uploaderId: string,
  id = randomUUID(),
  now = new Date(),
  scope?: 'resources',
) {
  const date = now.toISOString().slice(0, 10).replace(/-/g, '/');
  return `quarantine/${scope ? `${scope}/` : ''}${date}/${uploaderId}/${id}`;
}

export function cleanStorageKey(storageKey: string) {
  return storageKey.startsWith('quarantine/') ? `clean/${storageKey.slice('quarantine/'.length)}` : storageKey;
}

export function counterpartStorageKey(storageKey: string) {
  if (storageKey.startsWith('quarantine/')) return cleanStorageKey(storageKey);
  if (storageKey.startsWith('clean/')) return `quarantine/${storageKey.slice('clean/'.length)}`;
  return null;
}

export function attachmentVariantKeys(storageKey: string) {
  return [
    storageKey,
    ...ATTACHMENT_DERIVATIVE_WIDTHS.map((width) => `${storageKey}.thumb-${width}.webp`),
  ];
}

export function attachmentObjectKeys(storageKey: string) {
  const bases = [storageKey, counterpartStorageKey(storageKey)].filter((value): value is string => Boolean(value));
  return [...new Set(bases.flatMap(attachmentVariantKeys))];
}

export type ClamAvVerdict =
  | { status: 'CLEAN' }
  | { status: 'INFECTED'; signature: string };

async function writeSocket(socket: net.Socket, chunk: Uint8Array) {
  if (socket.write(chunk)) return;
  await new Promise<void>((resolve, reject) => {
    const onDrain = () => { cleanup(); resolve(); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => {
      socket.off('drain', onDrain);
      socket.off('error', onError);
    };
    socket.once('drain', onDrain);
    socket.once('error', onError);
  });
}

async function *asChunks(input: Uint8Array | AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  if (Symbol.asyncIterator in Object(input)) {
    for await (const chunk of input as AsyncIterable<Uint8Array>) yield chunk;
  } else {
    yield input as Uint8Array;
  }
}

export async function scanWithClamAv(
  input: Uint8Array | AsyncIterable<Uint8Array>,
  options: {
    host?: string;
    port?: number;
    timeoutMs?: number;
    maxBytes?: number;
    onChunk?: (chunk: Uint8Array) => void;
  } = {},
): Promise<ClamAvVerdict> {
  const host = options.host || process.env.CLAMAV_HOST || 'clamav';
  const port = options.port || Number(process.env.CLAMAV_PORT || 3310);
  const timeoutMs = options.timeoutMs || Number(process.env.CLAMAV_TIMEOUT_MS || 30_000);
  const maxBytes = options.maxBytes || MAX_ATTACHMENT_BYTES;
  const socket = net.createConnection({ host, port });
  let timeout: NodeJS.Timeout | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
      timeout = setTimeout(() => reject(new Error('ClamAV connection timed out.')), timeoutMs);
    });
    if (timeout) clearTimeout(timeout);
    socket.setTimeout(timeoutMs);
    socket.once('timeout', () => socket.destroy(new Error('ClamAV scan timed out.')));
    await writeSocket(socket, Buffer.from('zINSTREAM\0'));
    let total = 0;
    for await (const rawChunk of asChunks(input)) {
      const chunk = Buffer.from(rawChunk);
      total += chunk.byteLength;
      if (total > maxBytes) throw new AttachmentValidationError('FILE_TOO_LARGE', '파일 크기가 허용 범위를 벗어났습니다.');
      options.onChunk?.(chunk);
      const length = Buffer.allocUnsafe(4);
      length.writeUInt32BE(chunk.byteLength);
      await writeSocket(socket, length);
      await writeSocket(socket, chunk);
    }
    await writeSocket(socket, Buffer.alloc(4));

    const response = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      socket.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        if (chunk.includes(0) || chunk.includes(10)) resolve(Buffer.concat(chunks).toString('utf8').replace(/[\0\r\n]+$/g, ''));
      });
      socket.once('error', reject);
      socket.once('end', () => resolve(Buffer.concat(chunks).toString('utf8').replace(/[\0\r\n]+$/g, '')));
    });
    const found = response.match(/^stream: (.+) FOUND$/);
    if (found) return { status: 'INFECTED', signature: found[1]!.slice(0, 200) };
    if (response === 'stream: OK') return { status: 'CLEAN' };
    throw new Error(`ClamAV returned an invalid response: ${response.slice(0, 200)}`);
  } finally {
    if (timeout) clearTimeout(timeout);
    socket.destroy();
  }
}
