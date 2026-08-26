import prisma from '@/lib/prisma';
import { decryptText, encryptText, hashToken, privateFingerprint, randomToken } from '@/lib/server/crypto';
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
import {
  canonicalizeRiroId,
  isLegacySyntheticRiroFingerprint,
  riroAccountFingerprint,
  verifyRiroAccount,
} from '@/lib/server/riro';
import { resolveSession } from '@/lib/server/session';
import { parseStudentCode } from '@/lib/server/student-invites';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    enforceClientIpRateLimit(request, 'riro-reverify', {
      limit: 30,
      windowMs: 15 * 60 * 1_000,
    });
    await enforceDistributedClientIpRateLimit(request, 'riro-reverify', {
      limit: 30,
      windowMs: 15 * 60 * 1_000,
      failPolicy: 'closed',
    });

    const session = await resolveSession(request);
    if (
      !session ||
      session.user.role !== 'USER' ||
      !['ACTIVE', 'PENDING_REVERIFICATION'].includes(session.user.status)
    ) {
      throw new ApiError(401, 'AUTH_REQUIRED', '재인증할 학생 계정으로 로그인해 주세요.');
    }
    enforceRateLimit(`riro-reverify-account:${session.user.id}`, {
      limit: 6,
      windowMs: 15 * 60 * 1_000,
    });
    await enforceDistributedRateLimit(`riro-reverify-account:${session.user.id}`, {
      limit: 6,
      windowMs: 15 * 60 * 1_000,
      failPolicy: 'closed',
    });

    const body = await readJson<{ id?: unknown; password?: unknown }>(request, 8_192);
    const id = canonicalizeRiroId(
      requiredString(body.id, '리로스쿨 아이디', { min: 2, max: 32 }),
    );
    const password = requiredString(body.password, '리로스쿨 비밀번호', {
      min: 1,
      max: 128,
      trim: false,
    });
    const profile = await verifyRiroAccount(id, password);
    const student = parseStudentCode(profile.studentCode);

    const identity = await prisma.studentIdentity.findUnique({
      where: { userId: session.user.id },
      select: {
        studentCode: true,
        generation: true,
        encryptedName: true,
        riroAccountFingerprint: true,
      },
    });
    if (!identity) {
      throw new ApiError(400, 'STUDENT_IDENTITY_MISSING', '학생 신원 정보가 없습니다.');
    }
    const storedName = decryptText(identity.encryptedName).normalize('NFKC').trim();
    const verifiedName = profile.name.normalize('NFKC').trim();
    const verifiedAccountFingerprint = riroAccountFingerprint(id);
    if (
      identity.studentCode !== student.studentCode ||
      identity.generation !== profile.generation ||
      storedName !== verifiedName ||
      (
        identity.riroAccountFingerprint !== verifiedAccountFingerprint &&
        !isLegacySyntheticRiroFingerprint(
          identity.riroAccountFingerprint,
          identity.studentCode,
        )
      )
    ) {
      throw new ApiError(403, 'IDENTITY_MISMATCH', '기존 계정과 리로스쿨 학생 정보가 일치하지 않습니다.');
    }

    const ticket = randomToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1_000);
    await prisma.$transaction([
      prisma.verificationTicket.deleteMany({ where: { expiresAt: { lt: now } } }),
      prisma.verificationTicket.create({
        data: {
          tokenHash: hashToken(ticket),
          purpose: 'REVERIFY',
          expiresAt,
          encryptedName: encryptText(verifiedName),
          nameFingerprint: privateFingerprint(`${verifiedName}|${student.studentCode}`),
          riroAccountFingerprint: verifiedAccountFingerprint,
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
        name: verifiedName,
        studentCode: student.studentCode,
        generation: profile.generation,
        grade: profile.grade,
        classNumber: profile.classNumber,
        studentNumber: profile.studentNumber,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
