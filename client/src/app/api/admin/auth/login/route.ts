import prisma from '@/lib/prisma';
import { privateFingerprint, verifyPassword } from '@/lib/server/crypto';
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
import { attachAdminSessionCookie, createPortalSession, publicUser } from '@/lib/server/session';

export const runtime = 'nodejs';

interface AdminLoginBody {
  identifier?: unknown;
  password?: unknown;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    enforceClientIpRateLimit(request, 'admin-login', {
      limit: 30,
      windowMs: 15 * 60 * 1000,
    });
    await enforceDistributedClientIpRateLimit(request, 'admin-login', {
      limit: 30,
      windowMs: 15 * 60 * 1000,
      failPolicy: 'closed',
    });
    const body = await readJson<AdminLoginBody>(request, 8_192);
    const identifier = requiredString(body.identifier ?? 'admin', '관리자 아이디', {
      min: 2,
      max: 32,
    });
    enforceRateLimit(`admin-login-account:${privateFingerprint(identifier)}`, {
      limit: 8,
      windowMs: 15 * 60 * 1_000,
    });
    await enforceDistributedRateLimit(`admin-login-account:${privateFingerprint(identifier)}`, {
      limit: 8,
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
      where: { loginId: identifier },
      include: { studentIdentity: true },
    });
    if (
      !user ||
      !['ADMIN', 'DEVELOPER'].includes(user.role) ||
      user.status !== 'ACTIVE' ||
      !(await verifyPassword(password, user.passwordHash))
    ) {
      throw new ApiError(401, 'INVALID_ADMIN_CREDENTIALS', '관리자 아이디 또는 비밀번호가 올바르지 않습니다.');
    }
    const adminSession = await createPortalSession(user.id, request, 'ADMIN');
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return attachAdminSessionCookie(
      json({
        user: publicUser(user),
        mustChangePassword: user.mustChangePassword,
        totpRequired: false,
        expiresAt: adminSession.expiresAt.toISOString(),
      }),
      adminSession.token,
      adminSession.expiresAt,
    );
  } catch (error) {
    return jsonError(error);
  }
}
