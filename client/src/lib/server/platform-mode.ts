import { createHmac } from 'node:crypto';
import prisma from '@/lib/prisma';

export type PlatformMode = {
  bSideEnabled: boolean;
  bSideEpoch: number;
  updatedAt: Date;
};

const PLATFORM_SETTING_ID = 'global';
const CACHE_TTL_MS = 5_000;

let cachedMode: PlatformMode | null = null;
let cacheExpiresAt = 0;
let pendingMode: Promise<PlatformMode> | null = null;

function normalizedMode(value: PlatformMode): PlatformMode {
  return {
    bSideEnabled: Boolean(value.bSideEnabled),
    bSideEpoch: Math.max(0, Number(value.bSideEpoch) || 0),
    updatedAt: value.updatedAt,
  };
}

export async function getPlatformMode(options: { fresh?: boolean } = {}) {
  if (!options.fresh && cachedMode && Date.now() < cacheExpiresAt) return cachedMode;
  if (!options.fresh && pendingMode) return pendingMode;

  pendingMode = prisma.platformSetting
    .upsert({
      where: { id: PLATFORM_SETTING_ID },
      create: { id: PLATFORM_SETTING_ID },
      update: {},
      select: { bSideEnabled: true, bSideEpoch: true, updatedAt: true },
    })
    .then((mode) => {
      cachedMode = normalizedMode(mode);
      cacheExpiresAt = Date.now() + CACHE_TTL_MS;
      return cachedMode;
    })
    .finally(() => {
      pendingMode = null;
    });
  return pendingMode;
}

export function primePlatformMode(mode: PlatformMode) {
  cachedMode = normalizedMode(mode);
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
}

function pseudonymSecret() {
  const secret = process.env.PORTAL_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!secret) throw new Error('PORTAL_ENCRYPTION_KEY or SESSION_SECRET is required');
  return secret;
}

export function anonymousNickname(userId: string, epoch: number) {
  const digest = createHmac('sha256', pseudonymSecret())
    .update(`intact:b-side:${epoch}:${userId}`)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
  return `#${digest}`;
}

function maskIdentityTree(value: unknown, viewerId: string, mode: PlatformMode): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => maskIdentityTree(item, viewerId, mode));
  }
  if (!value || typeof value !== 'object' || value instanceof Date) return value;

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(source)) {
    result[key] = maskIdentityTree(nested, viewerId, mode);
  }

  if (
    typeof source.id === 'string' &&
    source.id !== viewerId &&
    typeof source.nickname === 'string'
  ) {
    const alias = anonymousNickname(source.id, mode.bSideEpoch);
    result.nickname = alias;
    if ('realName' in source) result.realName = alias;
    if ('profileImage' in source) result.profileImage = null;
    if ('studentId' in source) result.studentId = '------';
    if ('studentCode' in source) result.studentCode = '------';
    if (source.studentIdentity && typeof source.studentIdentity === 'object') {
      result.studentIdentity = {
        ...(result.studentIdentity as Record<string, unknown>),
        studentCode: '------',
      };
    }
  }

  return result;
}

export async function maskPublicIdentities<T>(value: T, viewerId: string): Promise<T> {
  const mode = await getPlatformMode();
  if (!mode.bSideEnabled) return value;
  return maskIdentityTree(value, viewerId, mode) as T;
}

export function maskPublicIdentitiesWithMode<T>(value: T, viewerId: string, mode: PlatformMode): T {
  if (!mode.bSideEnabled) return value;
  return maskIdentityTree(value, viewerId, mode) as T;
}
