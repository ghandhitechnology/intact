import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { Prisma, PrismaClient, type ModerationSubmission } from '@prisma/client';
import sharp from 'sharp';
import { awardIgk } from '../src/lib/server/igk';
import { perceptualAverageHash, perceptualHashDistance, sampleFrameIndexes } from '../src/lib/server/image-forensics';
import {
  analyzeLocalText,
  applyApprovedModerationCandidate,
  getModerationMode,
  validateModerationCandidateForApproval,
  type LocalRule,
} from '../src/lib/server/moderation';
import {
  claimNextModerationSubmission,
  compareAndSwapModerationState,
  lockModerationPostAndSubmission,
} from '../src/lib/server/moderation-state';
import { getObject } from '../src/lib/server/object-storage';

const prisma = new PrismaClient();
const execFileAsync = promisify(execFile);
const workerId = `moderation-${process.pid}`;
const adapterUrl = process.env.CODEX_MODERATION_URL || 'http://codex-moderation:8787';
const adapterSecret = process.env.CODEX_MODERATION_SECRET;
const pollMs = Number(process.env.MODERATION_POLL_MS || 1500);

type LunaVerdict = {
  decision: 'ALLOW' | 'NEEDS_REVIEW' | 'BLOCK';
  confidence: number;
  categories: string[];
  targetSpans: Array<{ source: string; start: number; end: number; text: string }>;
  evidence: string[];
  safeContext: boolean;
  evasionDetected: boolean;
  explanationKo: string;
};

type ImageEvidence = {
  attachmentId: string;
  frame: number;
  mimeType: string;
  buffer: Buffer;
  perceptualHash: string;
  ocr: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').slice(0, 1000);
}

type ClaimedModerationSubmission = ModerationSubmission & {
  transitionVersion: number;
  leaseToken: string;
};

async function claimNext(): Promise<ClaimedModerationSubmission | null> {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const claim = await claimNextModerationSubmission(tx, {
      now,
      leaseExpiresAt: new Date(now.getTime() + 5 * 60_000),
      leaseToken: randomUUID(),
    });
    if (!claim) return null;
    if (!claim.leaseToken) throw new Error('Claimed moderation submission has no lease token');
    const submission = await tx.moderationSubmission.findUniqueOrThrow({ where: { id: claim.id } });
    return {
      ...submission,
      transitionVersion: claim.transitionVersion,
      leaseToken: claim.leaseToken,
    };
  });
}

async function runOcr(buffer: Buffer, workDir: string, name: string) {
  const path = join(workDir, `${name}.png`);
  await writeFile(path, buffer);
  try {
    const { stdout } = await execFileAsync('tesseract', [path, 'stdout', '-l', 'kor+eng', '--psm', '6'], {
      timeout: 20_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return stdout.replace(/\s+/g, ' ').trim().slice(0, 10_000);
  } catch {
    return '';
  }
}

async function inspectImages(submission: ModerationSubmission, workDir: string) {
  const attachments = await prisma.attachment.findMany({
    where: { id: { in: submission.candidateAttachmentIds } },
    select: { id: true, storageKey: true, mimeType: true },
  });
  if (attachments.length !== submission.candidateAttachmentIds.length) throw new Error('A staged attachment is missing');
  const evidence: ImageEvidence[] = [];
  for (const attachment of attachments) {
    if (!attachment.mimeType.startsWith('image/')) continue;
    const response = await getObject(attachment.storageKey);
    const original = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(original, { animated: true }).metadata();
    const pages = Math.max(1, metadata.pages ?? 1);
    const frameIndexes = sampleFrameIndexes(pages);
    for (const frame of frameIndexes) {
      const sanitized = await sharp(original, { page: frame, pages: 1 })
        .rotate()
        .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      evidence.push({
        attachmentId: attachment.id,
        frame,
        mimeType: 'image/jpeg',
        buffer: sanitized,
        perceptualHash: await perceptualAverageHash(sanitized),
        ocr: await runOcr(sanitized, workDir, `${attachment.id}-${frame}`),
      });
    }
  }
  return evidence;
}

function isLunaVerdict(value: unknown): value is LunaVerdict {
  if (!value || typeof value !== 'object') return false;
  const verdict = value as Partial<LunaVerdict>;
  return ['ALLOW', 'NEEDS_REVIEW', 'BLOCK'].includes(verdict.decision ?? '')
    && typeof verdict.confidence === 'number' && verdict.confidence >= 0 && verdict.confidence <= 1
    && Array.isArray(verdict.categories) && Array.isArray(verdict.targetSpans) && Array.isArray(verdict.evidence)
    && typeof verdict.safeContext === 'boolean' && typeof verdict.evasionDetected === 'boolean'
    && typeof verdict.explanationKo === 'string';
}

async function callLuna(input: {
  submission: ModerationSubmission;
  local: ReturnType<typeof analyzeLocalText>;
  ocrText: string;
  images: ImageEvidence[];
}) {
  if (!adapterSecret) throw new Error('CODEX_MODERATION_SECRET is not configured');
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const form = new FormData();
      form.set('payload', JSON.stringify({
        submissionId: input.submission.id,
        originalText: `${input.submission.candidateTitle}\n${input.submission.candidateContentText}`,
        reconstructedText: input.local.normalized,
        ocrText: input.ocrText,
        localSignals: input.local,
        imageSignals: input.images.map(({ attachmentId, frame, perceptualHash, ocr }) => ({ attachmentId, frame, perceptualHash, ocr })),
      }));
      input.images.forEach((image, index) => {
        form.append('images', new Blob([Uint8Array.from(image.buffer)], { type: image.mimeType }), `image-${index}.jpg`);
      });
      const response = await fetch(`${adapterUrl}/v1/classify`, {
        method: 'POST',
        headers: { authorization: `Bearer ${adapterSecret}` },
        body: form,
        signal: AbortSignal.timeout(80_000),
      });
      if (!response.ok) throw new Error(`Codex adapter HTTP ${response.status}`);
      const verdict: unknown = await response.json();
      if (!isLunaVerdict(verdict)) throw new Error('Codex adapter returned an invalid verdict');
      return verdict;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(1000 * (2 ** attempt));
    }
  }
  throw lastError;
}

function chooseDecision(local: ReturnType<typeof analyzeLocalText>, luna: LunaVerdict, blockedImageHash: boolean) {
  if ((local.exactDeny || blockedImageHash) && luna.decision === 'BLOCK' && luna.confidence >= 0.95) return 'BLOCKED' as const;
  if (local.targetDetected || local.threat || local.evasionDetected || luna.evasionDetected || local.maxSeverity >= 70 || blockedImageHash) return 'NEEDS_REVIEW' as const;
  if (luna.decision === 'ALLOW' && luna.confidence >= 0.8) return 'ALLOWED' as const;
  return 'NEEDS_REVIEW' as const;
}

async function finish(submission: ClaimedModerationSubmission, input: {
  state: 'ALLOWED' | 'BLOCKED' | 'NEEDS_REVIEW';
  local: ReturnType<typeof analyzeLocalText>;
  luna: LunaVerdict;
  ocrText: string;
  imageSignals: Array<{ attachmentId: string; frame: number; perceptualHash: string; ocr: string }>;
}) {
  return prisma.$transaction(async (tx) => {
    const control = await lockModerationPostAndSubmission(tx, submission.id);
    if (
      !control
      || control.state !== 'PROCESSING'
      || control.transitionVersion !== submission.transitionVersion
      || control.leaseToken !== submission.leaseToken
    ) {
      return false;
    }
    const current = await tx.moderationSubmission.findUniqueOrThrow({ where: { id: submission.id } });
    const post = await tx.post.findUniqueOrThrow({ where: { id: current.postId } });
    const validation = await validateModerationCandidateForApproval(tx, current, post);
    let finalState = input.state;
    let explanationKo = input.luna.explanationKo.slice(0, 1000);
    if (!validation.ok) {
      finalState = 'NEEDS_REVIEW';
      explanationKo = validation.conflict === 'POST_VERSION_CONFLICT'
        ? '심사 중 게시물 버전이 변경되어 운영자 확인이 필요해요.'
        : '심사 중 첨부 파일이 변경되어 운영자 확인이 필요해요.';
    }

    const transitioned = await compareAndSwapModerationState(
      tx,
      submission.id,
      {
        state: 'PROCESSING',
        transitionVersion: submission.transitionVersion,
        leaseToken: submission.leaseToken,
      },
      finalState,
      'WORKER_RESULT',
    );
    if (transitioned === null) return false;

    const mode = getModerationMode();
    if (mode === 'ENFORCE' && finalState === 'ALLOWED') {
      const approval = await applyApprovedModerationCandidate(tx, current, post, {
        revisionReason: '이중망 승인 전 버전',
      });
      if (!approval.ok) throw new Error(`Moderation approval changed after validation: ${approval.conflict}`);
      await awardIgk(tx, {
        userId: current.authorId,
        amount: 10,
        type: 'POST_CREATED',
        idempotencyKey: `post:create:${post.id}`,
        sourceType: 'POST',
        sourceId: post.id,
        dailyCap: 100,
        note: '이중망 승인 게시글 작성 보상',
      });
    } else if (mode === 'ENFORCE' && finalState === 'BLOCKED' && current.isNewPost) {
      await tx.post.update({
        where: { id: current.postId },
        data: { status: 'HIDDEN', version: { increment: 1 } },
      });
    }
    await tx.moderationSubmission.update({
      where: { id: submission.id },
      data: {
        decision: finalState === 'ALLOWED' ? 'ALLOW' : finalState === 'BLOCKED' ? 'BLOCK' : 'REVIEW',
        riskScore: Math.max(input.local.maxSeverity / 100, input.luna.confidence),
        categories: input.luna.categories,
        targetSpans: input.luna.targetSpans as Prisma.InputJsonValue,
        evidence: { luna: input.luna.evidence, images: input.imageSignals } as Prisma.InputJsonValue,
        safeContext: input.luna.safeContext,
        evasionDetected: input.local.evasionDetected || input.luna.evasionDetected,
        explanationKo,
        normalizedText: input.local.normalized,
        ocrText: input.ocrText,
        localSignals: input.local as unknown as Prisma.InputJsonValue,
        lunaResult: input.luna as unknown as Prisma.InputJsonValue,
      },
    });
    return true;
  });
}

async function markWorkerFailure(submission: ClaimedModerationSubmission) {
  return prisma.$transaction(async (tx) => {
    const control = await lockModerationPostAndSubmission(tx, submission.id);
    if (
      !control
      || control.state !== 'PROCESSING'
      || control.transitionVersion !== submission.transitionVersion
      || control.leaseToken !== submission.leaseToken
    ) {
      return false;
    }
    const transitioned = await compareAndSwapModerationState(
      tx,
      submission.id,
      {
        state: 'PROCESSING',
        transitionVersion: submission.transitionVersion,
        leaseToken: submission.leaseToken,
      },
      'NEEDS_REVIEW',
      'WORKER_RESULT',
    );
    if (transitioned === null) return false;
    await tx.moderationSubmission.update({
      where: { id: submission.id },
      data: {
        decision: 'REVIEW',
        explanationKo: '자동 검사를 완료하지 못해 운영자 확인으로 전환했어요.',
      },
    });
    return true;
  });
}

async function processSubmission(submission: ClaimedModerationSubmission) {
  const startedAt = Date.now();
  const workDir = await mkdtemp(join(tmpdir(), 'intact-moderation-'));
  try {
    const [rules, images] = await Promise.all([
      prisma.moderationRule.findMany({ where: { enabled: true } }),
      inspectImages(submission, workDir),
    ]);
    const localRules: LocalRule[] = rules.map((rule) => ({
      id: rule.id, kind: rule.kind, pattern: rule.pattern, normalized: rule.normalized, severity: rule.severity,
    }));
    const ocrText = images.map((image) => image.ocr).filter(Boolean).join('\n').slice(0, 30_000);
    const local = analyzeLocalText(`${submission.candidateTitle}\n${submission.candidateContentText}\n${ocrText}`, localRules);
    const blockedHashes = rules.filter((rule) => rule.kind === 'IMAGE_HASH').map((rule) => rule.normalized);
    const blockedImageHash = images.some((image) => blockedHashes.some((hash) => perceptualHashDistance(image.perceptualHash, hash) <= 5));
    await prisma.moderationAttempt.create({
      data: { submissionId: submission.id, layer: 'LOCAL', status: 'OK', latencyMs: Date.now() - startedAt, result: { ...local, blockedImageHash } as Prisma.InputJsonValue },
    });
    const lunaStarted = Date.now();
    const luna = await callLuna({ submission, local, ocrText, images });
    await prisma.moderationAttempt.create({
      data: { submissionId: submission.id, layer: 'LUNA', status: 'OK', latencyMs: Date.now() - lunaStarted, result: luna as unknown as Prisma.InputJsonValue },
    });
    await finish(submission, {
      state: chooseDecision(local, luna, blockedImageHash), local, luna, ocrText,
      imageSignals: images.map(({ attachmentId, frame, perceptualHash, ocr }) => ({ attachmentId, frame, perceptualHash, ocr })),
    });
  } catch (error) {
    await prisma.moderationAttempt.create({
      data: { submissionId: submission.id, layer: 'WORKER', status: 'ERROR', latencyMs: Date.now() - startedAt, sanitizedError: safeError(error) },
    }).catch(() => undefined);
    await markWorkerFailure(submission);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function main() {
  console.info(`[${workerId}] moderation worker started in ${getModerationMode()} mode`);
  while (true) {
    const submission = await claimNext();
    if (!submission) {
      await sleep(pollMs);
      continue;
    }
    await processSubmission(submission);
  }
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

main().catch(async (error) => {
  console.error(safeError(error));
  await prisma.$disconnect();
  process.exit(1);
});
