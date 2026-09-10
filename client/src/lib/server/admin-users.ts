import type { Prisma } from '@prisma/client';
import { decryptText } from './crypto';

export const adminUserSelect = {
  id: true,
  createdAt: true,
  loginId: true,
  nickname: true,
  realName: true,
  profileImage: true,
  role: true,
  status: true,
  currentIgk: true,
  lifetimeIgk: true,
  igkDebt: true,
  level: true,
  lastLoginAt: true,
  lastReverifiedAt: true,
  reverifyDueAt: true,
  requiresRiroReverification: true,
  withdrawnAt: true,
  studentIdentity: true,
  _count: {
    select: {
      posts: true,
      comments: true,
      reportsAgainst: { where: { status: { in: ['OPEN', 'REVIEWING'] } } },
    },
  },
} satisfies Prisma.UserSelect;

type IdentityShape = {
  encryptedName: string;
  nameFingerprint?: string;
  riroAccountFingerprint?: string;
} | null;

export function publicAdminUser<T extends { realName: string | null; studentIdentity: IdentityShape }>(
  user: T,
) {
  return {
    ...user,
    realName: user.studentIdentity ? decryptAdminName(user.studentIdentity.encryptedName) : user.realName,
    studentIdentity: user.studentIdentity
      ? {
          ...user.studentIdentity,
          encryptedName: undefined,
          nameFingerprint: undefined,
          riroAccountFingerprint: undefined,
        }
      : null,
  };
}

function decryptAdminName(encrypted: string) {
  try {
    return decryptText(encrypted);
  } catch {
    return '(복호화 실패)';
  }
}
