import type { Role, UserStatus } from '@prisma/client';
import prisma from '@/lib/prisma';
import type { PublicUser } from '@/types/api';
import { hashToken, privateFingerprint, randomToken } from './crypto';
import { ApiError, getClientIp } from './http';
import { assertNotMaintenance } from './platform-mode';

export const SESSION_COOKIE = 'igwak_session';
export const ADMIN_SESSION_COOKIE = 'igwak_admin_session';
export const CLIENT_CACHE_SCOPE_COOKIE = 'intact_cache_scope';
const PORTAL_SESSION_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SHORT_PORTAL_SESSION_AGE_MS = 12 * 60 * 60 * 1000;
const ADMIN_SESSION_AGE_MS = 45 * 60 * 1000;

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get('cookie') ?? '';
  for (const part of cookies.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

function requestToken(request: Request, cookieName = SESSION_COOKIE) {
  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice(7).trim();
    if (token) return token;
  }
  return cookieValue(request, cookieName);
}

export async function createPortalSession(
  userId: string,
  request: Request,
  scope: 'PORTAL' | 'ADMIN' = 'PORTAL',
  remember = true,
) {
  const token = randomToken();
  const expiresAt = new Date(
    Date.now() +
      (scope === 'ADMIN'
        ? ADMIN_SESSION_AGE_MS
        : remember
          ? PORTAL_SESSION_AGE_MS
          : SHORT_PORTAL_SESSION_AGE_MS),
  );
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      scope,
      expiresAt,
      userAgent: request.headers.get('user-agent')?.slice(0, 512) || null,
      ipHash: privateFingerprint(`ip:${getClientIp(request)}`),
    },
  });
  return { token, expiresAt };
}

export function attachAdminSessionCookie(response: Response, token: string, expiresAt: Date) {
  response.headers.append(
    'Set-Cookie',
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Expires=${expiresAt.toUTCString()}${
      process.env.NODE_ENV === 'production' ? '; Secure' : ''
    }`,
  );
  return response;
}

export function attachSessionCookie(response: Response, token: string, expiresAt: Date) {
  const cacheScope = privateFingerprint(`client-cache:${token}`).slice(0, 32);
  response.headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${
      process.env.NODE_ENV === 'production' ? '; Secure' : ''
    }`,
  );
  response.headers.append(
    'Set-Cookie',
    `${CLIENT_CACHE_SCOPE_COOKIE}=${cacheScope}; Path=/; SameSite=Lax; Expires=${expiresAt.toUTCString()}${
      process.env.NODE_ENV === 'production' ? '; Secure' : ''
    }`,
  );
  return response;
}

export function clearSessionCookie(response: Response) {
  response.headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${
      process.env.NODE_ENV === 'production' ? '; Secure' : ''
    }`,
  );
  response.headers.append(
    'Set-Cookie',
    `${CLIENT_CACHE_SCOPE_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0${
      process.env.NODE_ENV === 'production' ? '; Secure' : ''
    }`,
  );
  return response;
}

export function clearAdminSessionCookie(response: Response) {
  response.headers.append(
    'Set-Cookie',
    `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${
      process.env.NODE_ENV === 'production' ? '; Secure' : ''
    }`,
  );
  return response;
}

const sessionUserSelect = {
  id: true,
  loginId: true,
  nickname: true,
  realName: true,
  profileImage: true,
  role: true,
  status: true,
  currentIgk: true,
  lifetimeIgk: true,
  level: true,
  mustChangePassword: true,
  reverifyDueAt: true,
  studentIdentity: {
    select: {
      studentCode: true,
      generation: true,
      grade: true,
      classNumber: true,
      studentNumber: true,
      schoolYear: true,
    },
  },
} as const;

async function resolveScopedSession(
  request: Request,
  scope: 'PORTAL' | 'ADMIN',
  cookieName: string,
) {
  const token = requestToken(request, cookieName);
  if (!token) return null;

  const now = new Date();
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      lastSeenAt: true,
      scope: true,
      user: { select: sessionUserSelect },
    },
  });
  if (!session || session.scope !== scope || session.revokedAt || session.expiresAt <= now) return null;

  if (session.user.status === 'SUSPENDED') {
    const activeSanction = await prisma.sanction.findFirst({
      where: {
        targetUserId: session.user.id,
        revokedAt: null,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      select: { id: true },
    });
    if (!activeSanction) {
      await prisma.user.update({
        where: { id: session.user.id },
        data: { status: 'ACTIVE' },
      });
      session.user.status = 'ACTIVE';
    }
  }

  if (
    scope === 'PORTAL' &&
    session.user.role === 'USER' &&
    session.user.status === 'ACTIVE' &&
    session.user.reverifyDueAt &&
    session.user.reverifyDueAt <= now
  ) {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { status: 'PENDING_REVERIFICATION' },
    });
    session.user.status = 'PENDING_REVERIFICATION';
  }

  if (now.getTime() - session.lastSeenAt.getTime() > 15 * 60 * 1000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
  }
  return { id: session.id, expiresAt: session.expiresAt, user: session.user };
}

export function resolveSession(request: Request) {
  return resolveScopedSession(request, 'PORTAL', SESSION_COOKIE);
}

export function resolveAdminSession(request: Request) {
  return resolveScopedSession(request, 'ADMIN', ADMIN_SESSION_COOKIE);
}

export async function requireUser(request: Request) {
  // Hard lockout: while maintenance is on, no portal session may touch data.
  // Admin routes use requireAdmin/requireReadyAdmin, which stay open.
  await assertNotMaintenance();
  const session = await resolveSession(request);
  if (!session) {
    throw new ApiError(401, 'AUTH_REQUIRED', '로그인이 필요합니다.');
  }

  if (session.user.role === 'ADMIN' || session.user.role === 'DEVELOPER') {
    throw new ApiError(403, 'ADMIN_SCOPE_REQUIRED', '관리자 작업은 관리자 전용 세션으로 이용해 주세요.');
  }

  const allowed: UserStatus[] = ['ACTIVE'];
  if (!allowed.includes(session.user.status)) {
    const messages: Partial<Record<UserStatus, string>> = {
      PENDING_REVERIFICATION: '재학생 재인증이 필요합니다.',
      SUSPENDED: '이용이 정지된 계정입니다.',
      GRADUATED: '재학생 계정만 이용할 수 있습니다.',
      WITHDRAWN: '탈퇴 처리된 계정입니다.',
    };
    throw new ApiError(403, 'ACCOUNT_UNAVAILABLE', messages[session.user.status] ?? '이용할 수 없는 계정입니다.');
  }
  return session;
}

export async function requireAdmin(request: Request) {
  const session = await resolveAdminSession(request);
  if (!session) {
    throw new ApiError(401, 'ADMIN_AUTH_REQUIRED', '관리자 로그인이 필요합니다.');
  }
  if (session.user.status !== 'ACTIVE') {
    throw new ApiError(403, 'ACCOUNT_UNAVAILABLE', '이용할 수 없는 관리자 계정입니다.');
  }
  const adminRoles: Role[] = ['ADMIN', 'DEVELOPER'];
  if (!adminRoles.includes(session.user.role)) {
    throw new ApiError(403, 'ADMIN_REQUIRED', '관리자 권한이 필요합니다.');
  }
  return session;
}

export async function requireReadyAdmin(request: Request) {
  const session = await requireAdmin(request);
  if (session.user.mustChangePassword) {
    throw new ApiError(
      403,
      'ADMIN_PASSWORD_CHANGE_REQUIRED',
      '관리 기능을 사용하기 전에 초기 비밀번호를 변경해 주세요.',
    );
  }
  return session;
}

export async function revokeRequestSession(request: Request) {
  const token = requestToken(request, SESSION_COOKIE);
  if (!token) return;
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAdminRequestSession(request: Request) {
  const token = requestToken(request, ADMIN_SESSION_COOKIE);
  if (!token) return;
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), scope: 'ADMIN', revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function publicUser(user: {
  id: string;
  nickname: string;
  realName: string | null;
  profileImage: string | null;
  role: Role;
  level: number;
  studentIdentity?: { studentCode: string } | null;
}): PublicUser {
  return {
    id: user.id,
    nickname: user.nickname,
    realName: user.realName ?? user.nickname,
    studentCode: user.studentIdentity?.studentCode ?? null,
    role: user.role,
    level: user.level,
    profileImage: user.profileImage,
  };
}
