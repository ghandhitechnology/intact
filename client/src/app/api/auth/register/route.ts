import prisma from '@/lib/prisma';
import { decryptText, hashPassword, hashToken } from '@/lib/server/crypto';
import {
  ApiError,
  assertSameOrigin,
  enforceClientIpRateLimit,
  enforceDistributedClientIpRateLimit,
  enforceDistributedRateLimit,
  enforceRateLimit,
  isUniqueConstraintError,
  json,
  jsonError,
  readJson,
  requiredString,
} from '@/lib/server/http';
import { assertNotMaintenance } from '@/lib/server/platform-mode';
import { attachSessionCookie, createPortalSession, publicUser } from '@/lib/server/session';
import { parseStudentCode } from '@/lib/server/student-invites';
import { withTransactionRetry } from '@/lib/server/transactions';

export const runtime = 'nodejs';

interface RegisterBody {
  verificationTicket?: unknown;
  studentCode?: unknown;
  password?: unknown;
}

function validatePassword(password: string, identityText: string) {
  if (password.length < 10 || password.length > 128) {
    throw new ApiError(400, 'WEAK_PASSWORD', '비밀번호는 10자 이상 128자 이하여야 합니다.');
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new ApiError(400, 'WEAK_PASSWORD', '비밀번호에는 영문자와 숫자를 모두 포함해 주세요.');
  }
  if (password.toLowerCase().includes(identityText.toLowerCase())) {
    throw new ApiError(400, 'WEAK_PASSWORD', '비밀번호에 이름을 포함할 수 없습니다.');
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await assertNotMaintenance();
    enforceClientIpRateLimit(request, 'register', {
      limit: 60,
      windowMs: 15 * 60 * 1_000,
    });
    await enforceDistributedClientIpRateLimit(request, 'register', {
      limit: 60,
      windowMs: 15 * 60 * 1_000,
      failPolicy: 'closed',
    });
    const body = await readJson<RegisterBody>(request, 16_384);
    const verificationTicket = requiredString(body.verificationTicket, '인증 티켓', {
      min: 32,
      max: 128,
    });
    const verificationTokenHash = hashToken(verificationTicket);
    enforceRateLimit(`register-ticket:${verificationTokenHash}`, {
      limit: 5,
      windowMs: 15 * 60 * 1_000,
    });
    await enforceDistributedRateLimit(`register-ticket:${verificationTokenHash}`, {
      limit: 5,
      windowMs: 15 * 60 * 1_000,
      failPolicy: 'closed',
    });
    const submittedStudent = parseStudentCode(
      requiredString(body.studentCode, '학번', { min: 6, max: 6 }),
    );
    const password = requiredString(body.password, '비밀번호', {
      min: 10,
      max: 128,
      trim: false,
    });
    const checkedAt = new Date();
    const preparedTicket = await prisma.verificationTicket.findUnique({
      where: { tokenHash: verificationTokenHash },
      include: { studentInvite: { select: { id: true } } },
    });
    if (
      !preparedTicket ||
      preparedTicket.purpose !== 'REGISTER' ||
      preparedTicket.usedAt ||
      preparedTicket.expiresAt <= checkedAt
    ) {
      throw new ApiError(400, 'INVALID_TICKET', '인증이 만료되었습니다. 다시 인증해 주세요.');
    }
    parseStudentCode(preparedTicket.studentCode);
    if (preparedTicket.studentInvite) {
      throw new ApiError(400, 'RIRO_REQUIRED', '회원가입 전에 리로스쿨 인증이 필요합니다.');
    }
    if (submittedStudent.studentCode !== preparedTicket.studentCode) {
      throw new ApiError(
        400,
        'STUDENT_CODE_MISMATCH',
        '입력한 학번이 리로스쿨 학적 정보와 일치하지 않습니다.',
      );
    }
    const realName = decryptText(preparedTicket.encryptedName);
    validatePassword(password, realName);
    if (password.includes(preparedTicket.studentCode)) {
      throw new ApiError(400, 'WEAK_PASSWORD', '비밀번호에 학번을 포함할 수 없습니다.');
    }
    const passwordHash = await hashPassword(password);
    const internalNickname = `${preparedTicket.studentCode}-${realName}`.slice(0, 32);

    const user = await withTransactionRetry(() => prisma.$transaction(
      async (tx) => {
        const registrationTime = new Date();
        const ticket = await tx.verificationTicket.findUnique({
          where: { tokenHash: verificationTokenHash },
          include: { studentInvite: { select: { id: true } } },
        });
        if (
          !ticket ||
          ticket.id !== preparedTicket.id ||
          ticket.purpose !== 'REGISTER' ||
          ticket.usedAt ||
          ticket.expiresAt <= registrationTime
        ) {
          throw new ApiError(400, 'INVALID_TICKET', '인증이 만료되었습니다. 다시 인증해 주세요.');
        }
        parseStudentCode(ticket.studentCode);
        if (ticket.studentInvite) {
          throw new ApiError(400, 'RIRO_REQUIRED', '회원가입 전에 리로스쿨 인증이 필요합니다.');
        }
        if (submittedStudent.studentCode !== ticket.studentCode) {
          throw new ApiError(
            400,
            'STUDENT_CODE_MISMATCH',
            '입력한 학번이 리로스쿨 학적 정보와 일치하지 않습니다.',
          );
        }
        const consumed = await tx.verificationTicket.updateMany({
          where: {
            id: ticket.id,
            usedAt: null,
            expiresAt: { gt: registrationTime },
          },
          data: { usedAt: registrationTime },
        });
        if (consumed.count !== 1) {
          throw new ApiError(400, 'INVALID_TICKET', '인증이 만료되었습니다. 다시 인증해 주세요.');
        }

        const [existingIdentity, existingLogin] = await Promise.all([
          tx.studentIdentity.findFirst({
            where: {
              OR: [
                { studentCode: ticket.studentCode },
                { nameFingerprint: ticket.nameFingerprint },
                { riroAccountFingerprint: ticket.riroAccountFingerprint },
              ],
            },
            select: { id: true },
          }),
          tx.user.findUnique({
            where: { loginId: ticket.studentCode },
            select: { id: true },
          }),
        ]);
        if (existingIdentity || existingLogin) {
          throw new ApiError(409, 'ALREADY_REGISTERED', '이미 가입된 학생입니다.');
        }

        const created = await tx.user.create({
          data: {
            loginId: ticket.studentCode,
            nickname: internalNickname,
            realName,
            passwordHash,
            role: 'USER',
            status: 'ACTIVE',
            lastReverifiedAt: registrationTime,
            reverifyDueAt: new Date(ticket.schoolYear + 1, 2, 31),
            studentIdentity: {
              create: {
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
                verifiedAt: registrationTime,
              },
            },
          },
          include: { studentIdentity: true },
        });
        return created;
      },
      { isolationLevel: 'Serializable' },
    ));

    const session = await createPortalSession(user.id, request);
    return attachSessionCookie(
      json({ user: publicUser(user), mustChangePassword: false }, 201),
      session.token,
      session.expiresAt,
    );
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return jsonError(
        new ApiError(409, 'REGISTRATION_CONFLICT', '학번 또는 닉네임이 이미 사용 중입니다.'),
      );
    }
    return jsonError(error);
  }
}
