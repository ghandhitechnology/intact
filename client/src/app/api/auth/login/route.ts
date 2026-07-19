import prisma from '@/lib/prisma';
import { hashPassword, privateFingerprint, verifyPassword } from '@/lib/server/crypto';
import { ensureSystemDefaults } from '@/lib/server/defaults';
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
import { assertNotMaintenance } from '@/lib/server/platform-mode';
import { attachSessionCookie, createPortalSession, publicUser } from '@/lib/server/session';
import { parseStudentCode } from '@/lib/server/student-invites';

export const runtime = 'nodejs';

const dummyHash = hashPassword('invalid-user-timing-equalizer-1');

interface LoginBody {
  identifier?: unknown;
  studentId?: unknown;
  password?: unknown;
  remember?: unknown;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await assertNotMaintenance();
    enforceClientIpRateLimit(request, 'login', {
      limit: 100,
      windowMs: 15 * 60 * 1000,
    });
    await enforceDistributedClientIpRateLimit(request, 'login', {
      limit: 100,
      windowMs: 15 * 60 * 1000,
      failPolicy: 'closed',
    });
    const body = await readJson<LoginBody>(request, 8_192);
    const student = parseStudentCode(
      requiredString(body.identifier ?? body.studentId, '학번', {
        min: 6,
        max: 6,
      }),
    );
    enforceRateLimit(`login-account:${privateFingerprint(student.studentCode)}`, {
      limit: 12,
      windowMs: 15 * 60 * 1_000,
    });
    await enforceDistributedRateLimit(`login-account:${privateFingerprint(student.studentCode)}`, {
      limit: 12,
      windowMs: 15 * 60 * 1_000,
      failPolicy: 'closed',
    });
    const password = requiredString(body.password, '비밀번호', {
      min: 1,
      max: 128,
      trim: false,
    });

    await ensureSystemDefaults();
    const user = await prisma.user.findUnique({
      where: { loginId: student.studentCode },
      include: { studentIdentity: true },
    });
    const passwordMatches = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
    if (!user || !passwordMatches) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', '학번 또는 비밀번호가 올바르지 않습니다.');
    }
    if (user.role === 'ADMIN' || user.role === 'DEVELOPER') {
      throw new ApiError(403, 'ADMIN_LOGIN_REQUIRED', '관리자 전용 로그인을 이용해 주세요.');
    }

    if (user.status === 'SUSPENDED') {
      const activeSanction = await prisma.sanction.findFirst({
        where: {
          targetUserId: user.id,
          revokedAt: null,
          startsAt: { lte: new Date() },
          OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
        },
        select: { id: true },
      });
      if (!activeSanction) {
        user.status = 'ACTIVE';
        await prisma.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } });
      }
    }
    if (
      user.role === 'USER' &&
      user.status === 'ACTIVE' &&
      user.reverifyDueAt &&
      user.reverifyDueAt <= new Date()
    ) {
      user.status = 'PENDING_REVERIFICATION';
      await prisma.user.update({
        where: { id: user.id },
        data: { status: 'PENDING_REVERIFICATION' },
      });
    }
    if (user.status === 'PENDING_REVERIFICATION') {
      const limitedSession = await createPortalSession(
        user.id,
        request,
        'PORTAL',
        body.remember !== false,
      );
      return attachSessionCookie(
        json({
          authenticated: false as const,
          requiresReverification: true as const,
          user: publicUser(user),
          expiresAt: limitedSession.expiresAt.toISOString(),
        }),
        limitedSession.token,
        limitedSession.expiresAt,
      );
    }
    if (user.status !== 'ACTIVE') {
      const messages = {
        PENDING_REVERIFICATION: '재학생 재인증이 필요합니다.',
        SUSPENDED: '이용이 정지된 계정입니다.',
        GRADUATED: '재학생 계정만 이용할 수 있습니다.',
        WITHDRAWN: '탈퇴 처리된 계정입니다.',
      } as const;
      throw new ApiError(
        403,
        'ACCOUNT_UNAVAILABLE',
        messages[user.status as keyof typeof messages] ?? '이용할 수 없는 계정입니다.',
      );
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const session = await createPortalSession(
      user.id,
      request,
      'PORTAL',
      body.remember !== false,
    );
    return attachSessionCookie(
      json({
        user: publicUser(user),
        mustChangePassword: user.mustChangePassword,
        expiresAt: session.expiresAt.toISOString(),
      }),
      session.token,
      session.expiresAt,
    );
  } catch (error) {
    return jsonError(error);
  }
}
