import prisma from '@/lib/prisma';
import { hashPassword, hashToken, privateFingerprint } from '@/lib/server/crypto';
import {
  ApiError,
  assertSameOrigin,
  enforceClientIpRateLimit,
  enforceRateLimit,
  json,
  jsonError,
  readJson,
  requiredString,
} from '@/lib/server/http';
import { parseStudentCode } from '@/lib/server/student-invites';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    enforceClientIpRateLimit(request, 'password-reset', {
      limit: 30,
      windowMs: 15 * 60 * 1_000,
    });
    const body = await readJson<{ verificationTicket?: unknown; newPassword?: unknown }>(request, 8_192);
    const verificationTicket = requiredString(body.verificationTicket, '인증 티켓', { min: 20, max: 200 });
    enforceRateLimit(`password-reset-ticket:${privateFingerprint(verificationTicket)}`, {
      limit: 5,
      windowMs: 15 * 60 * 1_000,
    });
    const newPassword = requiredString(body.newPassword, '새 비밀번호', {
      min: 10,
      max: 128,
      trim: false,
    });
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      throw new ApiError(400, 'WEAK_PASSWORD', '비밀번호는 영문자와 숫자를 포함해 10자 이상으로 설정해 주세요.');
    }

    const now = new Date();
    const tokenHash = hashToken(verificationTicket);
    const passwordHash = await hashPassword(newPassword);
    const result = await prisma.$transaction(async (tx) => {
      const ticket = await tx.verificationTicket.findUnique({
        where: { tokenHash },
        include: { studentInvite: { select: { id: true } } },
      });
      if (!ticket || ticket.purpose !== 'RESET' || ticket.usedAt || ticket.expiresAt <= now) {
        throw new ApiError(400, 'INVALID_TICKET', '인증이 만료되었습니다. 운영자에게 새 비밀번호 재설정 코드를 요청해 주세요.');
      }
      parseStudentCode(ticket.studentCode);
      const identity = await tx.studentIdentity.findFirst({
        where: {
          OR: [
            { studentCode: ticket.studentCode },
            { nameFingerprint: ticket.nameFingerprint },
            { riroAccountFingerprint: ticket.riroAccountFingerprint },
          ],
        },
        include: { user: { select: { id: true, nickname: true, realName: true, role: true, status: true } } },
      });
      if (!identity || identity.user.role !== 'USER') {
        throw new ApiError(404, 'ACCOUNT_NOT_FOUND', '해당 재학생의 인텍트 계정을 찾을 수 없습니다.');
      }
      const normalizedPassword = newPassword.toLowerCase();
      if (
        normalizedPassword.includes(identity.user.nickname.toLowerCase()) ||
        normalizedPassword.includes(ticket.studentCode)
      ) {
        throw new ApiError(400, 'WEAK_PASSWORD', '비밀번호에 닉네임이나 학번을 포함할 수 없습니다.');
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
        where: { id: identity.user.id },
        data: {
          loginId: ticket.studentCode,
          passwordHash,
          status: identity.user.status === 'PENDING_REVERIFICATION' ? 'ACTIVE' : identity.user.status,
          lastReverifiedAt: now,
          reverifyDueAt: new Date(ticket.schoolYear + 1, 2, 31),
        },
      });
      await tx.session.updateMany({
        where: { userId: identity.user.id, revokedAt: null },
        data: { revokedAt: now },
      });
      if (ticket.studentInvite) {
        const consumed = await tx.studentInvite.updateMany({
          where: {
            id: ticket.studentInvite.id,
            purpose: 'RESET',
            claimedAt: { not: null },
            usedAt: null,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: {
            activeKey: null,
            usedAt: now,
            usedById: identity.user.id,
          },
        });
        if (consumed.count !== 1) {
          throw new ApiError(400, 'INVALID_TICKET', '학생 초대가 만료되었거나 취소되었습니다.');
        }
      }
      await tx.verificationTicket.update({
        where: { id: ticket.id },
        data: { usedAt: now },
      });
      return { studentCode: ticket.studentCode };
    }, { isolationLevel: 'Serializable' });

    return json({ reset: true, studentCode: result.studentCode });
  } catch (error) {
    return jsonError(error);
  }
}
