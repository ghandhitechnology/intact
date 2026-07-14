import prisma from '@/lib/prisma';
import { decryptText, encryptText, hashPassword, hashToken, privateFingerprint } from '@/lib/server/crypto';
import {
  ApiError,
  assertSameOrigin,
  enforceClientIpRateLimit,
  enforceRateLimit,
  isUniqueConstraintError,
  json,
  jsonError,
  readJson,
  requiredString,
} from '@/lib/server/http';
import { attachSessionCookie, createPortalSession, publicUser } from '@/lib/server/session';
import { currentKoreanSchoolYear, normalizeStudentName, parseStudentCode } from '@/lib/server/student-invites';

export const runtime = 'nodejs';

interface RegisterBody {
  verificationTicket?: unknown;
  nickname?: unknown;
  realName?: unknown;
  studentCode?: unknown;
  password?: unknown;
}

function validNickname(nickname: string) {
  const reserved = ['admin', 'administrator', '관리자', '운영자', '인텍트', '인텍트관리자'];
  return (
    /^[\p{L}\p{N}_-]{2,16}$/u.test(nickname) &&
    !reserved.includes(nickname.normalize('NFKC').toLowerCase())
  );
}

function validatePassword(password: string, nickname: string) {
  if (password.length < 10 || password.length > 128) {
    throw new ApiError(400, 'WEAK_PASSWORD', '비밀번호는 10자 이상 128자 이하여야 합니다.');
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new ApiError(400, 'WEAK_PASSWORD', '비밀번호에는 영문자와 숫자를 모두 포함해 주세요.');
  }
  if (password.toLowerCase().includes(nickname.toLowerCase())) {
    throw new ApiError(400, 'WEAK_PASSWORD', '비밀번호에 닉네임을 포함할 수 없습니다.');
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    enforceClientIpRateLimit(request, 'register', {
      limit: 60,
      windowMs: 15 * 60 * 1_000,
    });
    const body = await readJson<RegisterBody>(request, 16_384);
    const rawVerificationTicket = typeof body.verificationTicket === 'string'
      ? body.verificationTicket.trim()
      : '';

    if (!rawVerificationTicket) {
      const realName = normalizeStudentName(
        requiredString(body.realName, '실명', { min: 2, max: 40 }),
      );
      const student = parseStudentCode(
        requiredString(body.studentCode, '학번', { min: 6, max: 6 }),
      );
      enforceRateLimit(`open-register:${privateFingerprint(student.studentCode)}`, {
        limit: 6,
        windowMs: 15 * 60 * 1_000,
      });
      const password = requiredString(body.password, '비밀번호', {
        min: 10,
        max: 128,
        trim: false,
      });
      validatePassword(password, realName);
      if (password.includes(student.studentCode)) {
        throw new ApiError(400, 'WEAK_PASSWORD', '비밀번호에 학번을 포함할 수 없습니다.');
      }
      const now = new Date();
      const schoolYear = currentKoreanSchoolYear(now);
      const passwordHash = await hashPassword(password);
      const encryptedName = encryptText(realName);
      const nameFingerprint = privateFingerprint(`${realName}|${student.studentCode}`);
      const identityFingerprint = privateFingerprint(`open-registration:${student.studentCode}`);
      const internalNickname = `${student.studentCode}-${realName}`.slice(0, 32);

      const user = await prisma.$transaction(
        async (tx) => {
          const [existingIdentity, existingLogin] = await Promise.all([
            tx.studentIdentity.findUnique({
              where: { studentCode: student.studentCode },
              select: { id: true },
            }),
            tx.user.findUnique({
              where: { loginId: student.studentCode },
              select: { id: true },
            }),
          ]);
          if (existingIdentity || existingLogin) {
            throw new ApiError(409, 'ALREADY_REGISTERED', '이미 가입된 학번입니다.');
          }
          return tx.user.create({
            data: {
              loginId: student.studentCode,
              nickname: internalNickname,
              realName,
              passwordHash,
              role: 'USER',
              status: 'ACTIVE',
              studentIdentity: {
                create: {
                  ...student,
                  encryptedName,
                  nameFingerprint,
                  riroAccountFingerprint: identityFingerprint,
                  schoolYear,
                  verifiedAt: now,
                },
              },
            },
            include: { studentIdentity: true },
          });
        },
        { isolationLevel: 'Serializable' },
      );
      const session = await createPortalSession(user.id, request);
      return attachSessionCookie(
        json({ user: publicUser(user), mustChangePassword: false }, 201),
        session.token,
        session.expiresAt,
      );
    }

    const verificationTicket = requiredString(rawVerificationTicket, '인증 티켓', {
      min: 32,
      max: 128,
    });
    enforceRateLimit(`register-ticket:${hashToken(verificationTicket)}`, {
      limit: 5,
      windowMs: 15 * 60 * 1_000,
    });
    const nickname = requiredString(body.nickname, '닉네임', { min: 2, max: 16 });
    if (!validNickname(nickname)) {
      throw new ApiError(
        400,
        'INVALID_NICKNAME',
        '닉네임에는 한글, 영문, 숫자, 밑줄, 하이픈만 사용할 수 있습니다.',
      );
    }
    const password = requiredString(body.password, '비밀번호', {
      min: 10,
      max: 128,
      trim: false,
    });
    validatePassword(password, nickname);
    const passwordHash = await hashPassword(password);
    const now = new Date();

    const user = await prisma.$transaction(
      async (tx) => {
        const ticket = await tx.verificationTicket.findUnique({
          where: { tokenHash: hashToken(verificationTicket) },
          include: { studentInvite: { select: { id: true } } },
        });
        if (!ticket || ticket.purpose !== 'REGISTER' || ticket.usedAt || ticket.expiresAt <= now) {
          throw new ApiError(400, 'INVALID_TICKET', '인증이 만료되었습니다. 다시 인증해 주세요.');
        }
        parseStudentCode(ticket.studentCode);

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
            nickname,
            realName: decryptText(ticket.encryptedName),
            passwordHash,
            role: 'USER',
            status: 'ACTIVE',
            lastReverifiedAt: now,
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
                verifiedAt: now,
              },
            },
          },
          include: { studentIdentity: true },
        });
        if (ticket.studentInvite) {
          const consumed = await tx.studentInvite.updateMany({
            where: {
              id: ticket.studentInvite.id,
              purpose: 'REGISTER',
              claimedAt: { not: null },
              usedAt: null,
              revokedAt: null,
              expiresAt: { gt: now },
            },
            data: {
              activeKey: null,
              usedAt: now,
              usedById: created.id,
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
        return created;
      },
      { isolationLevel: 'Serializable' },
    );

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
