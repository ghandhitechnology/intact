import type { Prisma, VerificationPurpose } from '@prisma/client';
import { decryptText } from './crypto';
import { ApiError } from './http';
import { isValidStudentCode, STUDENT_CODE_REQUIREMENTS } from '../student-code';

export const verificationPurposes = ['REGISTER', 'RESET', 'REVERIFY'] as const;

export const studentInviteAdminInclude = {
  createdBy: { select: { id: true, nickname: true } },
  usedBy: { select: { id: true, nickname: true } },
  revokedBy: { select: { id: true, nickname: true } },
} satisfies Prisma.StudentInviteInclude;

export type AdminStudentInvite = Prisma.StudentInviteGetPayload<{
  include: typeof studentInviteAdminInclude;
}>;

export function parseVerificationPurpose(
  value: unknown,
  fallback: VerificationPurpose = 'REGISTER',
) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!verificationPurposes.includes(value as (typeof verificationPurposes)[number])) {
    throw new ApiError(400, 'INVALID_INVITE_PURPOSE', '초대 목적이 올바르지 않습니다.');
  }
  return value as VerificationPurpose;
}

export function normalizeStudentName(value: string) {
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!/^[\p{L} .'-]{2,40}$/u.test(normalized)) {
    throw new ApiError(
      400,
      'INVALID_STUDENT_NAME',
      '학생 이름은 한글 또는 영문 기준 2자 이상 40자 이하로 입력해 주세요.',
    );
  }
  return normalized;
}

export function parseStudentCode(value: string) {
  if (!isValidStudentCode(value)) {
    throw new ApiError(400, 'INVALID_STUDENT_CODE', STUDENT_CODE_REQUIREMENTS);
  }
  const generation = Number(value.slice(0, 2));
  const currentStudentNumber = value.slice(2);
  const grade = Number(currentStudentNumber[0]);
  const classNumber = Number(currentStudentNumber[1]);
  const studentNumber = Number(currentStudentNumber.slice(2));
  return {
    studentCode: value,
    currentStudentNumber,
    generation,
    grade,
    classNumber,
    studentNumber,
  };
}

export function currentKoreanSchoolYear(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month)) {
    throw new Error('Unable to determine the Korean school year.');
  }
  return month < 3 ? year - 1 : year;
}

export function inviteStatus(
  invite: Pick<AdminStudentInvite, 'claimedAt' | 'usedAt' | 'revokedAt' | 'expiresAt'>,
  now = new Date(),
) {
  if (invite.revokedAt) return 'REVOKED' as const;
  if (invite.usedAt) return 'USED' as const;
  if (invite.expiresAt <= now) return 'EXPIRED' as const;
  if (invite.claimedAt) return 'CLAIMED' as const;
  return 'ACTIVE' as const;
}

export function serializeAdminInvite(invite: AdminStudentInvite, now = new Date()) {
  return {
    id: invite.id,
    purpose: invite.purpose,
    status: inviteStatus(invite, now),
    realName: decryptText(invite.encryptedName),
    studentCode: invite.studentCode,
    currentStudentNumber: invite.currentStudentNumber,
    generation: invite.generation,
    grade: invite.grade,
    classNumber: invite.classNumber,
    studentNumber: invite.studentNumber,
    schoolYear: invite.schoolYear,
    createdAt: invite.createdAt.toISOString(),
    updatedAt: invite.updatedAt.toISOString(),
    expiresAt: invite.expiresAt.toISOString(),
    claimedAt: invite.claimedAt?.toISOString() ?? null,
    usedAt: invite.usedAt?.toISOString() ?? null,
    revokedAt: invite.revokedAt?.toISOString() ?? null,
    revokedReason: invite.revokedReason,
    createdBy: invite.createdBy,
    usedBy: invite.usedBy,
    revokedBy: invite.revokedBy,
  };
}
