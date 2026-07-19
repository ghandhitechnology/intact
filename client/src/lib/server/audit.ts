import type { Prisma } from '@prisma/client';
import { privateFingerprint } from './crypto';
import { getClientIp } from './http';

type Tx = Prisma.TransactionClient;

export function jsonSnapshot(value: unknown) {
  const sensitiveKeys = new Set([
    'passwordHash',
    'tokenHash',
    'codeHash',
    'encryptedName',
    'nameFingerprint',
    'riroAccountFingerprint',
    'identityFingerprint',
  ]);
  return JSON.parse(
    JSON.stringify(value, (key, nested: unknown) =>
      sensitiveKeys.has(key)
        ? '[REDACTED]'
        : typeof nested === 'bigint'
          ? nested.toString()
          : nested,
    ),
  ) as Prisma.InputJsonValue;
}

export async function writeAdminAudit(
  tx: Tx,
  request: Request,
  input: {
    adminId: string;
    action: string;
    targetType: string;
    targetId?: string | null;
    reason: string;
    before?: unknown;
    after?: unknown;
  },
) {
  return tx.adminAuditLog.create({
    data: {
      adminId: input.adminId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      before: input.before === undefined ? undefined : jsonSnapshot(input.before),
      after: input.after === undefined ? undefined : jsonSnapshot(input.after),
      ipHash: privateFingerprint(`ip:${getClientIp(request)}`),
    },
  });
}
