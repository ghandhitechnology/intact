import { createHash, randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import {
  ATTACHMENT_DERIVATIVE_WIDTHS,
  ATTACHMENT_STATUS,
  AttachmentValidationError,
  attachmentObjectKeys,
  attachmentVariantKeys,
  cleanStorageKey,
  scanWithClamAv,
  validateAttachmentBytes,
} from '../src/lib/server/attachment-state';
import { deleteObject, deleteObjects, getObject, putObject } from '../src/lib/server/object-storage';

const prisma = new PrismaClient();
const workerId = `attachment-${process.pid}`;
const pollMs = Number(process.env.ATTACHMENT_POLL_MS || 1_500);
const leaseMs = Number(process.env.ATTACHMENT_LEASE_MS || 5 * 60_000);
const maxAttempts = Number(process.env.ATTACHMENT_MAX_ATTEMPTS || 3);

interface AttachmentJob {
  id: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: bigint;
  sha256: string;
  processingError: string | null;
}

interface LeaseMetadata {
  attempt: number;
  leaseToken?: string;
  leaseExpiresAt?: string;
  nextAttemptAt?: string;
  error?: string;
  workerId?: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/(password|secret|token|authorization)=?\S*/gi, '$1=[REDACTED]')
    .slice(0, 700);
}

function parseMetadata(raw: string | null): LeaseMetadata {
  if (!raw) return { attempt: 0 };
  try {
    const value = JSON.parse(raw) as Partial<LeaseMetadata>;
    return { ...value, attempt: Number.isSafeInteger(value.attempt) ? Number(value.attempt) : 0 };
  } catch {
    return { attempt: 0 };
  }
}

async function claimNext(): Promise<(AttachmentJob & { leaseToken: string; attempt: number }) | null> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<AttachmentJob[]>(Prisma.sql`
      SELECT "id", "storageKey", "mimeType", "sizeBytes", "sha256", "processingError"
      FROM "Attachment"
      WHERE (
        "scanStatus" = ${ATTACHMENT_STATUS.PENDING}
        AND COALESCE(
          CASE WHEN "processingError" ~ '^\\s*\\{'
            THEN (("processingError"::jsonb)->>'nextAttemptAt')::timestamptz
          END,
          '-infinity'::timestamptz
        ) <= NOW()
      ) OR (
        "scanStatus" = ${ATTACHMENT_STATUS.PROCESSING}
        AND COALESCE(
          CASE WHEN "processingError" ~ '^\\s*\\{'
            THEN (("processingError"::jsonb)->>'leaseExpiresAt')::timestamptz
          END,
          '-infinity'::timestamptz
        ) <= NOW()
      )
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    const job = rows[0];
    if (!job) return null;
    const attempt = parseMetadata(job.processingError).attempt + 1;
    const leaseToken = randomUUID();
    const metadata: LeaseMetadata = {
      attempt,
      leaseToken,
      leaseExpiresAt: new Date(Date.now() + leaseMs).toISOString(),
      workerId,
    };
    await tx.$executeRaw(Prisma.sql`
      UPDATE "Attachment"
      SET "scanStatus" = ${ATTACHMENT_STATUS.PROCESSING},
          "processingError" = ${JSON.stringify(metadata)},
          "finalizedAt" = NULL
      WHERE "id" = ${job.id}::uuid
    `);
    return { ...job, leaseToken, attempt };
  });
}

async function *responseChunks(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return;
      yield result.value;
    }
  } finally {
    reader.releaseLock();
  }
}

function imageEncoder(image: sharp.Sharp, mimeType: string) {
  switch (mimeType) {
    case 'image/jpeg': return image.jpeg({ quality: 92, mozjpeg: true });
    case 'image/png': return image.png({ compressionLevel: 9, adaptiveFiltering: true });
    case 'image/gif': return image.gif({ effort: 7 });
    case 'image/webp': return image.webp({ quality: 90, effort: 5 });
    case 'image/avif': return image.avif({ quality: 70, effort: 5 });
    default: throw new AttachmentValidationError('INVALID_IMAGE', '지원하지 않는 이미지 형식입니다.');
  }
}

async function sanitizeImage(bytes: Buffer, mimeType: string) {
  try {
    const source = sharp(bytes, { animated: true, failOn: 'error', limitInputPixels: 40_000_000 }).rotate();
    const sanitized = await imageEncoder(source, mimeType).toBuffer();
    const metadata = await sharp(sanitized, { animated: true, failOn: 'error' }).metadata();
    if (!metadata.width || !metadata.height) throw new Error('Processed image dimensions are missing.');
    const blur = await sharp(sanitized, { animated: false, failOn: 'error' })
      .resize({ width: 24, withoutEnlargement: true })
      .webp({ quality: 45 })
      .toBuffer();
    const derivatives = await Promise.all(ATTACHMENT_DERIVATIVE_WIDTHS.map(async (width) => ({
      width,
      bytes: await sharp(sanitized, { animated: false, failOn: 'error' })
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer(),
    })));
    return {
      bytes: sanitized,
      width: metadata.width,
      height: metadata.pageHeight || metadata.height,
      blurDataUrl: `data:image/webp;base64,${blur.toString('base64')}`,
      derivatives,
    };
  } catch (error) {
    if (error instanceof AttachmentValidationError) throw error;
    throw new AttachmentValidationError('INVALID_IMAGE', '이미지를 안전하게 다시 인코딩할 수 없습니다.');
  }
}

async function leaseUpdate(
  job: AttachmentJob & { leaseToken: string },
  set: Prisma.Sql,
) {
  return prisma.$executeRaw(Prisma.sql`
    UPDATE "Attachment"
    SET ${set}
    WHERE "id" = ${job.id}::uuid
      AND "scanStatus" = ${ATTACHMENT_STATUS.PROCESSING}
      AND "processingError" ~ '^\\s*\\{'
      AND ("processingError"::jsonb)->>'leaseToken' = ${job.leaseToken}
  `);
}

async function renewLease(job: AttachmentJob & { leaseToken: string; attempt: number }) {
  return leaseUpdate(job, Prisma.sql`
    "processingError" = ${JSON.stringify({
      attempt: job.attempt,
      leaseToken: job.leaseToken,
      leaseExpiresAt: new Date(Date.now() + leaseMs).toISOString(),
      workerId,
    })}
  `);
}

async function markTerminal(
  job: AttachmentJob & { leaseToken: string },
  status: 'INFECTED' | 'REJECTED' | 'FAILED',
  error: string,
) {
  return leaseUpdate(job, Prisma.sql`
    "scanStatus" = ${status},
    "processingError" = ${JSON.stringify({ attempt: parseMetadata(job.processingError).attempt + 1, error })},
    "finalizedAt" = NOW()
  `);
}

async function markRetry(job: AttachmentJob & { leaseToken: string; attempt: number }, error: unknown) {
  const message = safeError(error);
  if (job.attempt >= maxAttempts) {
    const updated = await leaseUpdate(job, Prisma.sql`
      "scanStatus" = ${ATTACHMENT_STATUS.FAILED},
      "processingError" = ${JSON.stringify({ attempt: job.attempt, error: message })},
      "finalizedAt" = NOW()
    `);
    return updated === 1;
  }
  const backoffMs = Math.min(60_000, 2 ** (job.attempt - 1) * 2_000);
  await leaseUpdate(job, Prisma.sql`
    "scanStatus" = ${ATTACHMENT_STATUS.PENDING},
    "processingError" = ${JSON.stringify({
      attempt: job.attempt,
      error: message,
      nextAttemptAt: new Date(Date.now() + backoffMs).toISOString(),
    })},
    "finalizedAt" = NULL
  `);
  return false;
}

async function processJob(job: AttachmentJob & { leaseToken: string; attempt: number }) {
  const quarantined = await getObject(job.storageKey);
  if (!quarantined.body) throw new Error('Quarantined object has no response body.');
  const chunks: Buffer[] = [];
  const verdict = await scanWithClamAv(responseChunks(quarantined.body), {
    maxBytes: Number(job.sizeBytes),
    onChunk: (chunk) => chunks.push(Buffer.from(chunk)),
  });
  const uploadedBytes = Buffer.concat(chunks);
  if (verdict.status === 'INFECTED') {
    const updated = await markTerminal(job, ATTACHMENT_STATUS.INFECTED, `Malware detected: ${verdict.signature}`);
    if (updated === 1) await deleteObjects(attachmentObjectKeys(job.storageKey));
    return;
  }

  const validated = await validateAttachmentBytes({
    bytes: uploadedBytes,
    declaredMimeType: job.mimeType,
    expectedSize: job.sizeBytes,
    expectedSha256: job.sha256,
  });
  let finalBytes: Uint8Array = uploadedBytes;
  let width = validated.width;
  let height = validated.height;
  let blurDataUrl: string | null = null;
  let derivatives: Array<{ width: number; bytes: Buffer }> = [];
  if (validated.mimeType.startsWith('image/')) {
    const processed = await sanitizeImage(uploadedBytes, validated.mimeType);
    finalBytes = processed.bytes;
    width = processed.width;
    height = processed.height;
    blurDataUrl = processed.blurDataUrl;
    derivatives = processed.derivatives;
  }

  const finalKey = cleanStorageKey(job.storageKey);
  await putObject(finalKey, finalBytes, validated.mimeType);
  await Promise.all(derivatives.map(({ width: derivativeWidth, bytes }) =>
    putObject(`${finalKey}.thumb-${derivativeWidth}.webp`, bytes, 'image/webp')));
  const finalSha256 = createHash('sha256').update(finalBytes).digest('hex');
  const updated = await leaseUpdate(job, Prisma.sql`
    "scanStatus" = ${ATTACHMENT_STATUS.CLEAN},
    "storageKey" = ${finalKey},
    "mimeType" = ${validated.mimeType},
    "sizeBytes" = ${BigInt(finalBytes.byteLength)},
    "sha256" = ${finalSha256},
    "width" = ${width},
    "height" = ${height},
    "blurDataUrl" = ${blurDataUrl},
    "processingError" = NULL,
    "finalizedAt" = NOW()
  `);
  if (updated !== 1) {
    const current = await prisma.attachment.findUnique({
      where: { id: job.id },
      select: { scanStatus: true },
    });
    if (
      !current
      || (current.scanStatus !== ATTACHMENT_STATUS.PROCESSING && current.scanStatus !== ATTACHMENT_STATUS.CLEAN)
    ) {
      await deleteObjects(attachmentVariantKeys(finalKey));
    }
    return;
  }
  await deleteObject(job.storageKey).catch((error) => {
    console.error(JSON.stringify({ event: 'attachment.quarantine_cleanup_failed', attachmentId: job.id, error: safeError(error) }));
  });
}

async function runJob(job: AttachmentJob & { leaseToken: string; attempt: number }) {
  let renewing = false;
  const heartbeat = setInterval(() => {
    if (renewing) return;
    renewing = true;
    void renewLease(job)
      .catch((error) => console.error(JSON.stringify({
        event: 'attachment.lease_renewal_failed',
        attachmentId: job.id,
        error: safeError(error),
      })))
      .finally(() => { renewing = false; });
  }, Math.max(1_000, Math.floor(leaseMs / 3)));
  heartbeat.unref();
  try {
    await processJob(job);
  } catch (error) {
    if (error instanceof AttachmentValidationError) {
      const updated = await markTerminal(job, ATTACHMENT_STATUS.REJECTED, safeError(error));
      if (updated === 1) await deleteObjects(attachmentObjectKeys(job.storageKey)).catch(() => undefined);
      return;
    }
    const terminal = await markRetry(job, error);
    if (terminal) await deleteObjects(attachmentObjectKeys(job.storageKey)).catch(() => undefined);
    console.error(JSON.stringify({ event: 'attachment.processing_failed', attachmentId: job.id, attempt: job.attempt, error: safeError(error) }));
  } finally {
    clearInterval(heartbeat);
  }
}

let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });

async function main() {
  console.log(JSON.stringify({ event: 'attachment.worker_started', workerId }));
  while (!stopping) {
    const job = await claimNext();
    if (!job) {
      await sleep(pollMs);
      continue;
    }
    await runJob(job);
  }
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ event: 'attachment.worker_crashed', error: safeError(error) }));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
