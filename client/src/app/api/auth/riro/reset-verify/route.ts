import prisma from '@/lib/prisma';
import { encryptText, hashToken, privateFingerprint, randomToken } from '@/lib/server/crypto';
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
import { verifyRiroAccount } from '@/lib/server/riro';
import { parseStudentCode } from '@/lib/server/student-invites';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    enforceClientIpRateLimit(request, 'riro-reset', {
      limit: 30,
      windowMs: 15 * 60 * 1_000,
    });
    const body = await readJson<{ id?: unknown; password?: unknown }>(request, 8_192);
    const id = requiredString(body.id, '리로스쿨 아이디', { min: 2, max: 32 });
    enforceRateLimit(`riro-reset-account:${privateFingerprint(id)}`, {
      limit: 5,
      windowMs: 15 * 60 * 1_000,
    });
    const password = requiredString(body.password, '리로스쿨 비밀번호', {
      min: 1,
      max: 128,
      trim: false,
    });
    const profile = await verifyRiroAccount(id, password);
    parseStudentCode(profile.studentCode);
    const riroAccountFingerprint = privateFingerprint(`riro-account:${id}`);
    const identity = await prisma.studentIdentity.findFirst({
      where: {
        OR: [
          { studentCode: profile.studentCode },
          { riroAccountFingerprint },
        ],
      },
      select: { id: true, user: { select: { role: true } } },
    });
    if (!identity || identity.user.role !== 'USER') {
      throw new ApiError(404, 'ACCOUNT_NOT_FOUND', '해당 재학생의 인텍트 계정을 찾을 수 없습니다.');
    }

    const ticket = randomToken();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1_000);
    await prisma.$transaction([
      prisma.verificationTicket.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
      prisma.verificationTicket.create({
        data: {
          tokenHash: hashToken(ticket),
          purpose: 'RESET',
          expiresAt,
          encryptedName: encryptText(profile.name),
          nameFingerprint: privateFingerprint(`${profile.name}|${profile.studentCode}`),
          riroAccountFingerprint,
          studentCode: profile.studentCode,
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
      profile: { name: profile.name, studentCode: profile.studentCode },
    });
  } catch (error) {
    return jsonError(error);
  }
}
