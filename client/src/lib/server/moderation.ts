import { createHash } from 'crypto';
import { Prisma, type ModerationSubmission, type Post, type PostKind } from '@prisma/client';
import {
  compareAndSwapModerationState,
  isNonterminalModerationState,
  lockModerationPost,
  readLatestModerationControl,
} from './moderation-state';

export type ModerationMode = 'OFF' | 'SHADOW' | 'ENFORCE';

export function getModerationMode(): ModerationMode {
  const value = process.env.MODERATION_MODE?.toUpperCase();
  return value === 'OFF' || value === 'ENFORCE' ? value : 'SHADOW';
}

const ZERO_WIDTH = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;
const SEPARATORS = /[\s\p{P}\p{S}_]+/gu;
const REPEATED = /(.)\1{2,}/gu;
const HOMOGLYPHS: Record<string, string> = {
  '0': 'ㅇ', '1': 'ㅣ', '2': '이', '3': 'ㅈ', '5': 'ㅅ', '7': 'ㄱ', '8': 'ㅂ', '9': 'ㄱ',
  o: 'ㅇ', i: 'ㅣ', l: 'ㅣ', v: 'ㅂ', c: 'ㄷ', x: 'ㅈ',
};

const KEYBOARD_JAMO: Record<string, string> = {
  r: 'ㄱ', R: 'ㄲ', s: 'ㄴ', e: 'ㄷ', E: 'ㄸ', f: 'ㄹ', a: 'ㅁ', q: 'ㅂ', Q: 'ㅃ',
  t: 'ㅅ', T: 'ㅆ', d: 'ㅇ', w: 'ㅈ', W: 'ㅉ', c: 'ㅊ', z: 'ㅋ', x: 'ㅌ', v: 'ㅍ', g: 'ㅎ',
  k: 'ㅏ', o: 'ㅐ', i: 'ㅑ', O: 'ㅒ', j: 'ㅓ', p: 'ㅔ', u: 'ㅕ', P: 'ㅖ', h: 'ㅗ',
  y: 'ㅛ', n: 'ㅜ', b: 'ㅠ', m: 'ㅡ', l: 'ㅣ',
};

function keyboardVariant(value: string) {
  return value.replace(/[A-Za-z]/g, (letter) => KEYBOARD_JAMO[letter] ?? letter);
}

const INITIAL_JAMO = [...'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'];
const MEDIAL_JAMO = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'];
const FINAL_JAMO = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];

function composeSimpleJamo(value: string) {
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    const initial = INITIAL_JAMO.indexOf(value[index] ?? '');
    const medial = MEDIAL_JAMO.indexOf(value[index + 1] ?? '');
    if (initial < 0 || medial < 0) {
      output += value[index];
      continue;
    }
    let final = 0;
    const possibleFinal = FINAL_JAMO.indexOf(value[index + 2] ?? '');
    const followedByVowel = MEDIAL_JAMO.includes(value[index + 3] ?? '');
    if (possibleFinal > 0 && !followedByVowel) final = possibleFinal;
    output += String.fromCharCode(0xac00 + ((initial * 21) + medial) * 28 + final);
    index += final ? 2 : 1;
  }
  return output;
}

export function normalizeForModeration(value: string) {
  const raw = value.replace(ZERO_WIDTH, '').toLowerCase();
  const nfkc = raw.normalize('NFKC');
  const compact = nfkc
    .split('')
    .map((character) => HOMOGLYPHS[character] ?? character)
    .join('')
    .replace(SEPARATORS, '')
    .replace(REPEATED, '$1$1')
    .normalize('NFC');
  const jamo = composeSimpleJamo(raw.replace(SEPARATORS, '').replace(REPEATED, '$1$1'));
  const keyboard = composeSimpleJamo(keyboardVariant(raw).replace(SEPARATORS, '').replace(REPEATED, '$1$1'));
  return Array.from(new Set([nfkc.replace(/\s+/g, ' ').trim(), compact, jamo, keyboard])).join('\n');
}

export function moderationInputHash(input: {
  title: string;
  contentText: string;
  boardId: string;
  attachmentIds: string[];
}) {
  return createHash('sha256').update(JSON.stringify({
    title: input.title,
    contentText: input.contentText,
    boardId: input.boardId,
    attachmentIds: [...input.attachmentIds].sort(),
  })).digest('hex');
}

export type LocalRule = {
  id: string;
  kind: 'TERM' | 'REGEX' | 'ALLOWLIST' | 'TARGET_ALIAS' | 'IMAGE_HASH';
  pattern: string;
  normalized: string;
  severity: number;
};

const BUILTIN_TERMS = [
  ['씨발', 95], ['시발', 90], ['개새끼', 95], ['병신', 90], ['좆', 95], ['닥쳐', 70],
  ['ㅆㅣㅂㅏㄹ', 95], ['ㅅㅣㅂㅏㄹ', 90], ['ㄱㅐㅅㅐㄲㅣ', 95], ['ㅂㅕㅇㅅㅣㄴ', 90], ['ㅈㅗㅈ', 95],
  ['죽여버', 100], ['죽어라', 100], ['패버', 95], ['신상털', 100], ['주소까', 100],
] as const;
const THREAT_PATTERN = /(죽여|죽어라|패버|가만안|칼로|찔러|불질러|신상\s*털|주소\s*까)/u;
const TARGET_PATTERN = /(?:너|니가|네가|걔|쟤|그놈|그년|선생님?|학생|[가-힣]{2,4}(?:은|는|이|가|한테|에게|보고))/u;
const QUOTE_CONTEXT = /(인용|신고|욕설\s*예시|하지\s*마|금지|교육|문학|기사|발언을\s*비판)/u;

export function analyzeLocalText(original: string, rules: LocalRule[] = []) {
  const normalized = normalizeForModeration(original);
  const allowMatches = rules.filter((rule) => rule.kind === 'ALLOWLIST' && normalized.includes(rule.normalized));
  const targetAliases = rules.filter((rule) => rule.kind === 'TARGET_ALIAS' && normalized.includes(rule.normalized));
  const matches: Array<{ id: string; kind: string; pattern: string; severity: number; exact: boolean }> = [];
  for (const [term, severity] of BUILTIN_TERMS) {
    if (normalized.includes(term)) matches.push({ id: `builtin:${term}`, kind: 'TERM', pattern: term, severity, exact: true });
  }
  for (const rule of rules) {
    if (rule.kind === 'TERM' && normalized.includes(rule.normalized)) {
      matches.push({ id: rule.id, kind: rule.kind, pattern: rule.pattern, severity: rule.severity, exact: true });
    } else if (rule.kind === 'REGEX') {
      try {
        if (new RegExp(rule.pattern, 'iu').test(original)) {
          matches.push({ id: rule.id, kind: rule.kind, pattern: rule.pattern, severity: rule.severity, exact: true });
        }
      } catch {
        // Invalid persisted regexes are ignored and remain visible to administrators.
      }
    }
  }
  const threat = THREAT_PATTERN.test(normalized);
  const safeContext = QUOTE_CONTEXT.test(original) && !threat;
  const targetDetected = !safeContext && (targetAliases.length > 0 || (matches.length > 0 && TARGET_PATTERN.test(original)));
  const evasionDetected = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(original)
    || matches.length > 0 && (
      /[가-힣ㄱ-ㅎㅏ-ㅣ][\s._*~|/-]+[가-힣ㄱ-ㅎㅏ-ㅣ]/u.test(original)
      || /[A-Za-z0-9]{2,}/.test(original)
    );
  const maxSeverity = Math.max(0, ...matches.map((match) => match.severity), threat ? 100 : 0);
  return {
    normalized,
    matches,
    allowMatches: allowMatches.map(({ id, pattern }) => ({ id, pattern })),
    targetAliases: targetAliases.map(({ id, pattern }) => ({ id, pattern })),
    targetDetected,
    threat,
    safeContext,
    evasionDetected,
    maxSeverity: safeContext ? Math.min(maxSeverity, allowMatches.length ? 30 : 50) : maxSeverity,
    exactDeny: matches.some((match) => match.exact && match.severity >= 90) && !safeContext,
  };
}

type Tx = Prisma.TransactionClient;

export async function queueModerationSubmission(tx: Tx, input: {
  postId: string;
  authorId: string;
  basePostUpdatedAt?: Date | null;
  title: string;
  content: string;
  contentText: string;
  tags: string[];
  metadata?: Prisma.InputJsonValue | null;
  boardId: string;
  kind: PostKind;
  attachmentIds: string[];
  isNewPost: boolean;
}) {
  const inputHash = moderationInputHash(input);
  if (!await lockModerationPost(tx, input.postId)) {
    throw new Error('Moderation post disappeared while queuing');
  }

  while (true) {
    const latestControl = await readLatestModerationControl(tx, input.postId);
    if (!latestControl) break;
    const latest = await tx.moderationSubmission.findUniqueOrThrow({ where: { id: latestControl.id } });
    if (latest.inputHash === inputHash && isNonterminalModerationState(latestControl.state)) {
      return latest;
    }
    if (!isNonterminalModerationState(latestControl.state)) break;
    const supersededVersion = await compareAndSwapModerationState(
      tx,
      latestControl.id,
      latestControl,
      'SUPERSEDED',
      'SYSTEM_SUPERSEDE',
    );
    if (supersededVersion !== null) break;
  }

  return tx.moderationSubmission.create({
    data: {
      postId: input.postId,
      authorId: input.authorId,
      basePostUpdatedAt: input.basePostUpdatedAt,
      inputHash,
      normalizedText: normalizeForModeration(`${input.title}\n${input.contentText}`),
      candidateTitle: input.title,
      candidateContent: input.content,
      candidateContentText: input.contentText,
      candidateTags: input.tags,
      candidateMetadata: input.metadata === null ? Prisma.JsonNull : input.metadata,
      candidateBoardId: input.boardId,
      candidateKind: input.kind,
      candidateAttachmentIds: input.attachmentIds,
      isNewPost: input.isNewPost,
    },
  });
}

type ModerationCandidate = Pick<
  ModerationSubmission,
  | 'postId'
  | 'authorId'
  | 'basePostUpdatedAt'
  | 'candidateTitle'
  | 'candidateContent'
  | 'candidateContentText'
  | 'candidateTags'
  | 'candidateMetadata'
  | 'candidateBoardId'
  | 'candidateKind'
  | 'candidateAttachmentIds'
  | 'isNewPost'
>;

type ModerationPost = Pick<Post, 'id' | 'updatedAt' | 'title' | 'content' | 'publishedAt' | 'editedAt'>;

export type ModerationApprovalConflict = 'POST_VERSION_CONFLICT' | 'STAGED_ATTACHMENT_CHANGED';

export function moderationBaseMatchesPost(submission: ModerationCandidate, post: ModerationPost) {
  return submission.postId === post.id
    && submission.basePostUpdatedAt !== null
    && submission.basePostUpdatedAt.getTime() === post.updatedAt.getTime();
}

async function lockAndValidateCandidateAttachments(tx: Tx, submission: ModerationCandidate) {
  const attachmentIds = [...new Set(submission.candidateAttachmentIds)];
  if (attachmentIds.length !== submission.candidateAttachmentIds.length) return false;
  if (attachmentIds.length === 0) return true;
  const ids = Prisma.join(attachmentIds.map((id) => Prisma.sql`${id}::uuid`));
  await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "Attachment"
    WHERE "id" IN (${ids})
    ORDER BY "id"
    FOR UPDATE
  `);
  const stagedAttachments = await tx.attachment.count({
    where: {
      id: { in: attachmentIds },
      uploaderId: submission.authorId,
      messageId: null,
      OR: [{ postId: null }, { postId: submission.postId }],
    },
  });
  return stagedAttachments === attachmentIds.length;
}

export async function validateModerationCandidateForApproval(
  tx: Tx,
  submission: ModerationCandidate,
  post: ModerationPost,
): Promise<{ ok: true } | { ok: false; conflict: ModerationApprovalConflict }> {
  if (!moderationBaseMatchesPost(submission, post)) {
    return { ok: false, conflict: 'POST_VERSION_CONFLICT' };
  }
  if (!await lockAndValidateCandidateAttachments(tx, submission)) {
    return { ok: false, conflict: 'STAGED_ATTACHMENT_CHANGED' };
  }
  return { ok: true };
}

export async function applyApprovedModerationCandidate(
  tx: Tx,
  submission: ModerationCandidate,
  post: ModerationPost,
  options: { revisionReason: string },
): Promise<{ ok: true } | { ok: false; conflict: ModerationApprovalConflict }> {
  const validation = await validateModerationCandidateForApproval(tx, submission, post);
  if (!validation.ok) return validation;
  if (!submission.isNewPost && (post.title !== submission.candidateTitle || post.content !== submission.candidateContent)) {
    await tx.postRevision.create({
      data: {
        postId: post.id,
        editorId: submission.authorId,
        title: post.title,
        content: post.content,
        reason: options.revisionReason.slice(0, 300),
      },
    });
  }
  await tx.attachment.updateMany({
    where: {
      id: { in: submission.candidateAttachmentIds },
      uploaderId: submission.authorId,
      postId: null,
      messageId: null,
    },
    data: { postId: post.id },
  });
  await tx.post.update({
    where: { id: post.id },
    data: {
      title: submission.candidateTitle,
      content: submission.candidateContent,
      contentText: submission.candidateContentText,
      tags: submission.candidateTags,
      metadata: submission.candidateMetadata === null ? Prisma.JsonNull : submission.candidateMetadata,
      boardId: submission.candidateBoardId,
      kind: submission.candidateKind,
      status: 'PUBLISHED',
      version: { increment: 1 },
      publishedAt: post.publishedAt ?? new Date(),
      editedAt: submission.isNewPost ? post.editedAt : new Date(),
    },
  });
  return { ok: true };
}

export function publicModerationStatus(submission: {
  id: string;
  state: string;
  explanationKo: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const message = submission.explanationKo ?? ({
    QUEUED: '이중망 검사를 기다리고 있어요.',
    PROCESSING: '한국어 우회 표현과 이미지를 검사하고 있어요.',
    NEEDS_REVIEW: '운영자가 내용을 확인하고 있어요.',
    ALLOWED: '검사가 완료되어 게시되었어요.',
    BLOCKED: '운영 정책에 따라 게시되지 않았어요.',
    FAILED: '자동 검사를 완료하지 못해 운영자 확인으로 전환했어요.',
    SUPERSEDED: '더 최신 버전으로 검사가 교체되었어요.',
  } as Record<string, string>)[submission.state] ?? '검사 상태를 확인하고 있어요.';
  return { id: submission.id, state: submission.state, message, createdAt: submission.createdAt, updatedAt: submission.updatedAt };
}
