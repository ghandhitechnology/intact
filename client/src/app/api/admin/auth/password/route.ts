import prisma from '@/lib/prisma';
import { hashPassword, verifyPassword } from '@/lib/server/crypto';
import { ApiError, assertSameOrigin, json, jsonError, readJson, requiredString } from '@/lib/server/http';
import { requireAdmin } from '@/lib/server/session';

export const runtime = 'nodejs';

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireAdmin(request);
    const body = await readJson<{ currentPassword?: unknown; newPassword?: unknown }>(request);
    const currentPassword = requiredString(body.currentPassword, '현재 비밀번호', { max: 128, trim: false });
    const newPassword = requiredString(body.newPassword, '새 비밀번호', {
      min: 12,
      max: 128,
      trim: false,
    });
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
      throw new ApiError(400, 'WEAK_PASSWORD', '관리자 비밀번호에는 영문자, 숫자, 특수문자를 모두 포함해 주세요.');
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new ApiError(401, 'INVALID_PASSWORD', '현재 비밀번호가 올바르지 않습니다.');
    }
    if (await verifyPassword(newPassword, user.passwordHash)) {
      throw new ApiError(400, 'PASSWORD_UNCHANGED', '새 비밀번호는 현재 비밀번호와 다르게 설정해 주세요.');
    }
    const passwordHash = await hashPassword(newPassword);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } }),
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
