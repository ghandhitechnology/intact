import prisma from '@/lib/prisma';
import { writeAdminAudit } from '@/lib/server/audit';
import { decryptText, encryptText, hashToken, privateFingerprint, randomToken } from '@/lib/server/crypto';
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
import { lockResources } from '@/lib/server/locks';
import { requireReadyAdmin } from '@/lib/server/session';
import {
  currentKoreanSchoolYear,
  inviteStatus,
  normalizeStudentName,
  parseStudentCode,
  parseVerificationPurpose,
  serializeAdminInvite,
  studentInviteAdminInclude,
} from '@/lib/server/student-invites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CreateInviteBody {
  realName?: unknown;
  studentCode?: unknown;
  expiresAt?: unknown;
  reason?: unknown;
  purpose?: unknown;
}

function parseExpiry(value: unknown, now: Date) {
  const raw = requiredString(value, '초대 만료 시각', { max: 100 });
  const expiresAt = new Date(raw);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new ApiError(400, 'INVALID_INVITE_EXPIRY', '초대 만료 시각이 올바르지 않습니다.');
  }
  if (expiresAt.getTime() < now.getTime() + 5 * 60 * 1_000) {
    throw new ApiError(400, 'INVALID_INVITE_EXPIRY', '초대는 현재 시각보다 최소 5분 뒤에 만료되어야 합니다.');
  }
  if (expiresAt.getTime() > now.getTime() + 90 * 24 * 60 * 60 * 1_000) {
    throw new ApiError(400, 'INVALID_INVITE_EXPIRY', '초대 유효기간은 최대 90일입니다.');
  }
  return expiresAt;
}

export async function GET(request: Request) {
  try {
    enforceClientIpRateLimit(request, 'admin-invites-list', {
      limit: 240,
      windowMs: 15 * 60 * 1_000,
    });
    const admin = await requireReadyAdmin(request);
    enforceRateLimit(`admin-invites-list:${admin.user.id}`, {
      limit: 240,
      windowMs: 15 * 60 * 1_000,
    });

    const url = new URL(request.url);
    const requestedPurpose = url.searchParams.get('purpose');
    const purpose = requestedPurpose
      ? parseVerificationPurpose(requestedPurpose)
      : null;
    const requestedStatus = url.searchParams.get('status')?.trim().toUpperCase() ?? '';
    const statuses = ['ACTIVE', 'CLAIMED', 'USED', 'REVOKED', 'EXPIRED'] as const;
    if (requestedStatus && !statuses.includes(requestedStatus as (typeof statuses)[number])) {
      throw new ApiError(400, 'INVALID_INVITE_STATUS', '초대 상태 필터가 올바르지 않습니다.');
    }
    const query = url.searchParams.get('q')?.normalize('NFKC').trim().toLowerCase().slice(0, 80);
    const now = new Date();
    const records = await prisma.studentInvite.findMany({
      where: purpose ? { purpose } : undefined,
      include: studentInviteAdminInclude,
      orderBy: { createdAt: 'desc' },
    });
    const invites = records
      .filter((invite) => !requestedStatus || inviteStatus(invite, now) === requestedStatus)
      .map((invite) => serializeAdminInvite(invite, now))
      .filter((invite) =>
        !query ||
        invite.studentCode.includes(query) ||
        invite.realName.normalize('NFKC').toLowerCase().includes(query),
      );
    return json({ invites });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    enforceClientIpRateLimit(request, 'admin-invites-create', {
      limit: 60,
      windowMs: 60 * 60 * 1_000,
    });
    const admin = await requireReadyAdmin(request);
    enforceRateLimit(`admin-invites-create:${admin.user.id}`, {
      limit: 60,
      windowMs: 60 * 60 * 1_000,
    });
    const body = await readJson<CreateInviteBody>(request, 16_384);
    const realName = normalizeStudentName(
      requiredString(body.realName, '학생 이름', { min: 2, max: 40 }),
    );
    const student = parseStudentCode(
      requiredString(body.studentCode, '학번', { min: 6, max: 6 }),
    );
    const purpose = parseVerificationPurpose(body.purpose);
    const reason = requiredString(body.reason, '발급 사유', { min: 2, max: 1_000 });
    const now = new Date();
    const expiresAt = parseExpiry(body.expiresAt, now);
    const code = randomToken(24);
    const activeKey = `${purpose}:${student.studentCode}`;
    const schoolYear = currentKoreanSchoolYear(now);

    const created = await prisma.$transaction(
      async (tx) => {
        await lockResources(tx, [`student-invite:${activeKey}`]);
        await tx.studentInvite.updateMany({
          where: { activeKey, usedAt: null, revokedAt: null, expiresAt: { lte: now } },
          data: { activeKey: null },
        });
        const activeInvite = await tx.studentInvite.findFirst({
          where: { activeKey, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
          select: { id: true, expiresAt: true },
        });
        if (activeInvite) {
          throw new ApiError(
            409,
            'ACTIVE_INVITE_EXISTS',
            '이 학생에게 아직 유효한 동일 목적의 초대가 있습니다. 기존 초대를 취소한 뒤 다시 발급해 주세요.',
            { inviteId: activeInvite.id, expiresAt: activeInvite.expiresAt.toISOString() },
          );
        }

        const [identity, existingLogin] = await Promise.all([
          tx.studentIdentity.findUnique({
            where: { studentCode: student.studentCode },
            include: { user: { select: { id: true, role: true, status: true } } },
          }),
          tx.user.findUnique({
            where: { loginId: student.studentCode },
            select: { id: true },
          }),
        ]);
        if (purpose === 'REGISTER' && (identity || existingLogin)) {
          throw new ApiError(409, 'ALREADY_REGISTERED', '이미 가입된 학생입니다.');
        }
        if (purpose !== 'REGISTER') {
          if (
            !identity ||
            identity.user.role !== 'USER' ||
            !['ACTIVE', 'PENDING_REVERIFICATION', 'SUSPENDED'].includes(identity.user.status)
          ) {
            throw new ApiError(404, 'ACCOUNT_NOT_FOUND', '해당 학번의 재학생 계정을 찾을 수 없습니다.');
          }
          const registeredName = decryptText(identity.encryptedName).normalize('NFKC').trim();
          if (registeredName !== realName) {
            throw new ApiError(409, 'IDENTITY_MISMATCH', '입력한 이름과 등록된 학생 정보가 일치하지 않습니다.');
          }
        }

        const encryptedName = identity?.encryptedName ?? encryptText(realName);
        const nameFingerprint = identity?.nameFingerprint ??
          privateFingerprint(`${realName}|${student.studentCode}`);
        const identityFingerprint = identity?.riroAccountFingerprint ??
          privateFingerprint(`student-code:${student.studentCode}`);
        const invite = await tx.studentInvite.create({
          data: {
            purpose,
            codeHash: hashToken(code),
            activeKey,
            expiresAt,
            encryptedName,
            nameFingerprint,
            identityFingerprint,
            ...student,
            schoolYear,
            createdById: admin.user.id,
          },
          include: studentInviteAdminInclude,
        });
        await writeAdminAudit(tx, request, {
          adminId: admin.user.id,
          action: 'STUDENT_INVITE_CREATE',
          targetType: 'STUDENT_INVITE',
          targetId: invite.id,
          reason,
          after: invite,
        });
        return invite;
      },
      { isolationLevel: 'Serializable' },
    );

    return json({ invite: serializeAdminInvite(created), code }, 201);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return jsonError(
        new ApiError(409, 'ACTIVE_INVITE_EXISTS', '동일한 학생의 유효한 초대가 이미 존재합니다.'),
      );
    }
    return jsonError(error);
  }
}
