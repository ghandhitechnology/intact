import prisma from '@/lib/prisma';
import { hashPassword, verifyPassword } from '@/lib/server/crypto';
import {
  ApiError,
  assertSameOrigin,
  enforceRateLimit,
  json,
  jsonError,
  readJson,
  requiredString,
} from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';

interface PasswordBody {
  currentPassword?: unknown;
  newPassword?: unknown;
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    enforceRateLimit(`password-change:${session.user.id}`, {
      limit: 10,
      windowMs: 60 * 60 * 1_000,
    });
    const body = await readJson<PasswordBody>(request, 8_192);
    const currentPassword = requiredString(body.currentPassword, '현재 비밀번호', {
      max: 128,
      trim: false,
    });
    const newPassword = requiredString(body.newPassword, '새 비밀번호', {
      min: 10,
      max: 128,
      trim: false,
    });
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      throw new ApiError(400, 'WEAK_PASSWORD', '새 비밀번호에는 영문자와 숫자를 모두 포함해 주세요.');
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new ApiError(401, 'INVALID_PASSWORD', '현재 비밀번호가 올바르지 않습니다.');
    }
    if (await verifyPassword(newPassword, user.passwordHash)) {
      throw new ApiError(400, 'PASSWORD_REUSED', '기존 비밀번호와 다른 비밀번호를 사용해 주세요.');
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
      }),
      prisma.session.updateMany({
        where: { userId: user.id, id: { not: session.id }, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return json({ changed: true });
  } catch (error) {
    return jsonError(error);
  }
}
