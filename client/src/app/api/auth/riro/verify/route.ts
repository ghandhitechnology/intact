import prisma from '@/lib/prisma';
import { encryptText, hashToken, privateFingerprint, randomToken } from '@/lib/server/crypto';
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
import {
  canonicalizeRiroId,
  riroAccountFingerprint,
  verifyRiroAccount,
} from '@/lib/server/riro';
import { parseStudentCode } from '@/lib/server/student-invites';

export const runtime = 'nodejs';

interface VerifyBody {
  id?: unknown;
  password?: unknown;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    enforceClientIpRateLimit(request, 'riro', {
      limit: 60,
      windowMs: 15 * 60 * 1000,
    });
    await enforceDistributedClientIpRateLimit(request, 'riro', {
      limit: 60,
      windowMs: 15 * 60 * 1000,
      failPolicy: 'closed',
    });
    const body = await readJson<VerifyBody>(request, 8_192);
    const id = canonicalizeRiroId(
      requiredString(body.id, '리로스쿨 아이디', { min: 2, max: 32 }),
    );
    const accountFingerprint = riroAccountFingerprint(id);
    enforceRateLimit(`riro-account:${accountFingerprint}`, {
      limit: 6,
      windowMs: 15 * 60 * 1_000,
    });
    await enforceDistributedRateLimit(`riro-account:${accountFingerprint}`, {
      limit: 6,
      windowMs: 15 * 60 * 1_000,
      failPolicy: 'closed',
    });
    const password = requiredString(body.password, '리로스쿨 비밀번호', {
      min: 1,
      max: 128,
      trim: false,
    });

    const profile = await verifyRiroAccount(id, password);
    const student = parseStudentCode(profile.studentCode);
    const [duplicateIdentity, duplicateLogin] = await Promise.all([
      prisma.studentIdentity.findFirst({
        where: {
          OR: [
            { studentCode: student.studentCode },
            { riroAccountFingerprint: accountFingerprint },
          ],
        },
        select: { id: true },
      }),
      prisma.user.findUnique({
        where: { loginId: student.studentCode },
        select: { id: true },
      }),
    ]);
    if (duplicateIdentity || duplicateLogin) {
      throw new ApiError(409, 'ALREADY_REGISTERED', '이미 가입된 학생입니다.');
    }

    const ticket = randomToken();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await prisma.$transaction([
      prisma.verificationTicket.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      }),
      prisma.verificationTicket.create({
        data: {
          tokenHash: hashToken(ticket),
          purpose: 'REGISTER',
          expiresAt,
          encryptedName: encryptText(profile.name),
          nameFingerprint: privateFingerprint(
            `${profile.name}|${profile.studentCode}`,
          ),
          riroAccountFingerprint: accountFingerprint,
          studentCode: student.studentCode,
          currentStudentNumber: profile.currentStudentNumber,
          generation: profile.generation,
          grade: profile.grade,
          classNumber: profile.classNumber,
          studentNumber: profile.studentNumber,
          schoolYear: profile.schoolYear,
        },
      }),
    ]);

    return json({
      verificationTicket: ticket,
      expiresAt: expiresAt.toISOString(),
      profile: {
        name: profile.name,
        studentCode: profile.studentCode,
        generation: profile.generation,
        grade: profile.grade,
        classNumber: profile.classNumber,
        studentNumber: profile.studentNumber,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return jsonError(new ApiError(409, 'ALREADY_REGISTERED', '이미 가입된 학생입니다.'));
    }
    return jsonError(error);
  }
}
