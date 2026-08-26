import prisma from '@/lib/prisma';
import { decryptText, hashToken } from '@/lib/server/crypto';
import {
  ApiError,
  assertSameOrigin,
  enforceClientIpRateLimit,
  enforceDistributedClientIpRateLimit,
  enforceDistributedRateLimit,
  enforceRateLimit,
  json,
  jsonError,
  readJson,
  requiredString,
} from '@/lib/server/http';
import { attachSessionCookie, createPortalSession, resolveSession } from '@/lib/server/session';
import { isLegacySyntheticRiroFingerprint } from '@/lib/server/riro';
import { parseStudentCode } from '@/lib/server/student-invites';
import { withTransactionRetry } from '@/lib/server/transactions';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    enforceClientIpRateLimit(request, 'reverify', {
      limit: 60,
      windowMs: 15 * 60 * 1_000,
    });
    await enforceDistributedClientIpRateLimit(request, 'reverify', {
      limit: 60,
      windowMs: 15 * 60 * 1_000,
      failPolicy: 'closed',
    });
    const session = await resolveSession(request);
    if (!session || !['ACTIVE', 'PENDING_REVERIFICATION'].includes(session.user.status)) {
      throw new ApiError(401, 'AUTH_REQUIRED', '재인증할 계정으로 로그인해 주세요.');
    }
    enforceRateLimit(`reverify-account:${session.user.id}`, {
      limit: 6,
      windowMs: 15 * 60 * 1_000,
    });
    await enforceDistributedRateLimit(`reverify-account:${session.user.id}`, {
      limit: 6,
      windowMs: 15 * 60 * 1_000,
      failPolicy: 'closed',
    });
    const body = await readJson<{ verificationTicket?: unknown }>(request, 8_192);
    const verificationTicket = requiredString(body.verificationTicket, '인증 티켓', {
      min: 20,
      max: 200,
    });
    const now = new Date();
    const tokenHash = hashToken(verificationTicket);

    const result = await withTransactionRetry(() => prisma.$transaction(async (tx) => {
      const ticket = await tx.verificationTicket.findUnique({ where: { tokenHash } });
      if (!ticket || ticket.purpose !== 'REVERIFY' || ticket.usedAt || ticket.expiresAt <= now) {
        throw new ApiError(400, 'INVALID_TICKET', '재인증이 만료되었습니다. 다시 인증해 주세요.');
      }
      const consumedTicket = await tx.verificationTicket.updateMany({
        where: {
          id: ticket.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (consumedTicket.count !== 1) {
        throw new ApiError(400, 'INVALID_TICKET', '재인증이 만료되었습니다. 다시 인증해 주세요.');
      }
      parseStudentCode(ticket.studentCode);
      const identity = await tx.studentIdentity.findUnique({
        where: { userId: session.user.id },
      });
      if (!identity) {
        throw new ApiError(400, 'STUDENT_IDENTITY_MISSING', '학생 신원 정보가 없습니다.');
      }
      const existingName = decryptText(identity.encryptedName).normalize('NFKC').trim();
      const verifiedName = decryptText(ticket.encryptedName).normalize('NFKC').trim();
      const linksLegacyRiroAccount =
        identity.studentCode === ticket.studentCode &&
        isLegacySyntheticRiroFingerprint(
          identity.riroAccountFingerprint,
          identity.studentCode,
        );
      if (
        (
          identity.riroAccountFingerprint !== ticket.riroAccountFingerprint &&
          !linksLegacyRiroAccount
        ) ||
        identity.generation !== ticket.generation ||
        existingName !== verifiedName
      ) {
        throw new ApiError(403, 'IDENTITY_MISMATCH', '기존 계정과 동일한 학생에게 발급된 재인증 코드가 아닙니다.');
      }
      const [claimedIdentity, claimedLogin] = await Promise.all([
        tx.studentIdentity.findUnique({
          where: { studentCode: ticket.studentCode },
          select: { userId: true },
        }),
        tx.user.findUnique({
          where: { loginId: ticket.studentCode },
          select: { id: true },
        }),
      ]);
      if (claimedIdentity && claimedIdentity.userId !== session.user.id) {
        throw new ApiError(409, 'STUDENT_CODE_IN_USE', '해당 학번은 이미 다른 계정에 연결되어 있습니다.');
      }
      if (claimedLogin && claimedLogin.id !== session.user.id) {
        throw new ApiError(409, 'STUDENT_CODE_IN_USE', '해당 학번은 이미 다른 계정에서 사용 중입니다.');
      }

      await tx.studentIdentity.update({
        where: { id: identity.id },
        data: {
          studentCode: ticket.studentCode,
          currentStudentNumber: ticket.currentStudentNumber,
          generation: ticket.generation,
          grade: ticket.grade,
          classNumber: ticket.classNumber,
          studentNumber: ticket.studentNumber,
          encryptedName: ticket.encryptedName,
          nameFingerprint: ticket.nameFingerprint,
          riroAccountFingerprint: ticket.riroAccountFingerprint,
          schoolYear: ticket.schoolYear,
          verifiedAt: now,
        },
      });
      await tx.user.update({
        where: { id: session.user.id },
        data: {
          loginId: ticket.studentCode,
          realName: verifiedName,
          status: 'ACTIVE',
          lastReverifiedAt: now,
          reverifyDueAt: new Date(ticket.schoolYear + 1, 2, 31),
          requiresRiroReverification: false,
        },
      });
      await tx.session.updateMany({
        where: { userId: session.user.id, scope: 'PORTAL', revokedAt: null },
        data: { revokedAt: now },
      });
      if (ticket.studentInviteId) {
        const consumedInvite = await tx.studentInvite.updateMany({
          where: {
            id: ticket.studentInviteId,
            purpose: 'REVERIFY',
            claimedAt: { not: null },
            usedAt: null,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: {
            usedAt: now,
            usedById: session.user.id,
            activeKey: null,
          },
        });
        if (consumedInvite.count !== 1) {
          throw new ApiError(409, 'INVITE_STATE_CHANGED', '재인증 코드 상태가 변경되었습니다. 새 코드를 요청해 주세요.');
        }
      }
      return { studentCode: ticket.studentCode, schoolYear: ticket.schoolYear };
    }, { isolationLevel: 'Serializable' }));

    const rotatedSession = await createPortalSession(
      session.user.id,
      request,
      'PORTAL',
      true,
      session.expiresAt,
    );
    return attachSessionCookie(
      json({
        reverified: true,
        studentCode: result.studentCode,
        reverifyDueAt: new Date(result.schoolYear + 1, 2, 31).toISOString(),
        expiresAt: rotatedSession.expiresAt.toISOString(),
      }),
      rotatedSession.token,
      rotatedSession.expiresAt,
    );
  } catch (error) {
    return jsonError(error);
  }
}
