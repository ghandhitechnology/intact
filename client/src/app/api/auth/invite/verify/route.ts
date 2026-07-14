import prisma from '@/lib/prisma';
import { decryptText, hashToken, randomToken } from '@/lib/server/crypto';
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
import { resolveSession } from '@/lib/server/session';
import { parseStudentCode, parseVerificationPurpose } from '@/lib/server/student-invites';

export const runtime = 'nodejs';

interface VerifyInviteBody {
  code?: unknown;
  purpose?: unknown;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    enforceClientIpRateLimit(request, 'student-invite-verify', {
      limit: 30,
      windowMs: 15 * 60 * 1_000,
    });
    const body = await readJson<VerifyInviteBody>(request, 8_192);
    const code = requiredString(body.code, '초대 코드', { min: 20, max: 128 });
    const codeHash = hashToken(code);
    const purpose = parseVerificationPurpose(body.purpose);
    enforceRateLimit(`student-invite-code:${codeHash}`, {
      limit: 5,
      windowMs: 15 * 60 * 1_000,
    });

    const session = purpose === 'REVERIFY' ? await resolveSession(request) : null;
    if (
      purpose === 'REVERIFY' &&
      (!session ||
        session.user.role !== 'USER' ||
        !['ACTIVE', 'PENDING_REVERIFICATION'].includes(session.user.status))
    ) {
      throw new ApiError(401, 'AUTH_REQUIRED', '재인증할 학생 계정으로 로그인해 주세요.');
    }

    const now = new Date();
    const verificationTicket = randomToken();
    const result = await prisma.$transaction(
      async (tx) => {
        const invite = await tx.studentInvite.findUnique({ where: { codeHash } });
        if (!invite || invite.purpose !== purpose) {
          throw new ApiError(400, 'INVALID_INVITE', '유효하지 않은 학생 초대 코드입니다.');
        }
        if (invite.revokedAt) {
          throw new ApiError(400, 'INVITE_REVOKED', '취소된 학생 초대입니다. 관리자에게 새 초대를 요청해 주세요.');
        }
        if (invite.usedAt || invite.claimedAt) {
          throw new ApiError(400, 'INVITE_ALREADY_USED', '이미 사용된 학생 초대입니다.');
        }
        if (invite.expiresAt <= now) {
          throw new ApiError(400, 'INVITE_EXPIRED', '학생 초대가 만료되었습니다. 관리자에게 새 초대를 요청해 주세요.');
        }
        parseStudentCode(invite.studentCode);

        const [identity, existingLogin] = await Promise.all([
          tx.studentIdentity.findUnique({
            where: { studentCode: invite.studentCode },
            include: { user: { select: { id: true, role: true, status: true } } },
          }),
          tx.user.findUnique({
            where: { loginId: invite.studentCode },
            select: { id: true },
          }),
        ]);
        if (purpose === 'REGISTER' && (identity || existingLogin)) {
          throw new ApiError(409, 'ALREADY_REGISTERED', '이미 가입된 학생입니다.');
        }
        if (purpose === 'RESET') {
          if (
            !identity ||
            identity.user.role !== 'USER' ||
            !['ACTIVE', 'PENDING_REVERIFICATION', 'SUSPENDED'].includes(identity.user.status)
          ) {
            throw new ApiError(404, 'ACCOUNT_NOT_FOUND', '해당 재학생의 계정을 찾을 수 없습니다.');
          }
        }
        if (purpose === 'REVERIFY') {
          if (!session || !identity || identity.user.id !== session.user.id) {
            throw new ApiError(403, 'IDENTITY_MISMATCH', '로그인한 계정과 초대의 학생 정보가 일치하지 않습니다.');
          }
        }

        const claimed = await tx.studentInvite.updateMany({
          where: {
            id: invite.id,
            claimedAt: null,
            usedAt: null,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { claimedAt: now },
        });
        if (claimed.count !== 1) {
          throw new ApiError(409, 'INVITE_STATE_CHANGED', '초대 상태가 변경되었습니다. 새 초대를 요청해 주세요.');
        }

        const expiresAt = new Date(
          Math.min(now.getTime() + 10 * 60 * 1_000, invite.expiresAt.getTime()),
        );
        await tx.verificationTicket.deleteMany({ where: { expiresAt: { lt: now } } });
        await tx.verificationTicket.create({
          data: {
            tokenHash: hashToken(verificationTicket),
            purpose,
            expiresAt,
            encryptedName: invite.encryptedName,
            nameFingerprint: invite.nameFingerprint,
            riroAccountFingerprint: invite.identityFingerprint,
            studentCode: invite.studentCode,
            currentStudentNumber: invite.currentStudentNumber,
            generation: invite.generation,
            grade: invite.grade,
            classNumber: invite.classNumber,
            studentNumber: invite.studentNumber,
            schoolYear: invite.schoolYear,
            studentInviteId: invite.id,
          },
        });

        return {
          expiresAt,
          profile: {
            name: decryptText(invite.encryptedName),
            studentCode: invite.studentCode,
            generation: invite.generation,
            grade: invite.grade,
            classNumber: invite.classNumber,
            studentNumber: invite.studentNumber,
          },
        };
      },
      { isolationLevel: 'Serializable' },
    );

    return json({
      verificationTicket,
      expiresAt: result.expiresAt.toISOString(),
      profile: result.profile,
    });
  } catch (error) {
    return jsonError(error);
  }
}
