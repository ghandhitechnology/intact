import { createHmac } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { ApiError } from '@/lib/server/http';
import { writeOutboxEvent } from './outbox';
import { getRedisClient, subscribeRedis } from './redis';
import { enrichPublicUserTree } from './igk-standing';

export type PlatformMode = {
  bSideEnabled: boolean;
  bSideEpoch: number;
  maintenanceEnabled: boolean;
  updatedAt: Date;
};

const PLATFORM_SETTING_ID = 'global';
const CACHE_TTL_MS = 5_000;
export const PLATFORM_INVALIDATION_CHANNEL = 'intact:platform:invalidate:v1';

let cachedMode: PlatformMode | null = null;
let cacheExpiresAt = 0;
let pendingMode: Promise<PlatformMode> | null = null;
let invalidationSubscription: Promise<void> | null = null;
let invalidationSubscribed = false;

export function platformModeVersion(mode: Pick<PlatformMode, 'bSideEpoch' | 'updatedAt'>) {
  return `${mode.bSideEpoch}:${mode.updatedAt.getTime()}`;
}

function ensureInvalidationSubscription() {
  if (invalidationSubscribed || invalidationSubscription || !process.env.REDIS_URL) return;
  invalidationSubscription = subscribeRedis(PLATFORM_INVALIDATION_CHANNEL, (raw) => {
    try {
      const message = JSON.parse(raw) as { version?: unknown };
      if (typeof message.version !== 'string') return;
      if (!cachedMode || platformModeVersion(cachedMode) !== message.version) {
        cachedMode = null;
        cacheExpiresAt = 0;
      }
    } catch {
      // Ignore malformed invalidations; the short database cache remains authoritative.
    }
  }).then((unsubscribe) => {
    invalidationSubscribed = Boolean(unsubscribe);
  }).finally(() => {
    invalidationSubscription = null;
  });
}

export async function publishPlatformInvalidationMessage(message: {
  version: string;
  bSideEnabled: boolean;
  maintenanceEnabled: boolean;
}) {
  const client = await getRedisClient();
  if (!client) return false;
  try {
    return (await client.publish(PLATFORM_INVALIDATION_CHANNEL, JSON.stringify(message))) > 0;
  } catch {
    return false;
  }
}

export async function publishPlatformModeInvalidation(
  mode: Pick<PlatformMode, 'bSideEnabled' | 'bSideEpoch' | 'maintenanceEnabled' | 'updatedAt'>,
) {
  return publishPlatformInvalidationMessage({
    version: platformModeVersion(mode),
    bSideEnabled: mode.bSideEnabled,
    maintenanceEnabled: mode.maintenanceEnabled,
  });
}

/** Queue this beside the platform update when the admin route adopts the outbox. */
export function queuePlatformModeInvalidation(tx: Prisma.TransactionClient, mode: PlatformMode) {
  const version = platformModeVersion(mode);
  return writeOutboxEvent(tx, {
    eventType: 'platform.mode.changed',
    aggregateType: 'PlatformSetting',
    aggregateId: 'global',
    dedupeKey: `platform:${version}`,
    payload: {
      version,
      bSideEnabled: mode.bSideEnabled,
      maintenanceEnabled: mode.maintenanceEnabled,
      updatedAt: mode.updatedAt.toISOString(),
    },
  });
}

function normalizedMode(value: PlatformMode): PlatformMode {
  return {
    bSideEnabled: Boolean(value.bSideEnabled),
    bSideEpoch: Math.max(0, Number(value.bSideEpoch) || 0),
    maintenanceEnabled: Boolean(value.maintenanceEnabled),
    updatedAt: value.updatedAt,
  };
}

export async function getPlatformMode(options: { fresh?: boolean } = {}) {
  ensureInvalidationSubscription();
  if (!options.fresh && cachedMode && Date.now() < cacheExpiresAt) return cachedMode;
  if (!options.fresh && pendingMode) return pendingMode;

  pendingMode = prisma.platformSetting
    .upsert({
      where: { id: PLATFORM_SETTING_ID },
      create: { id: PLATFORM_SETTING_ID },
      update: {},
      select: { bSideEnabled: true, bSideEpoch: true, maintenanceEnabled: true, updatedAt: true },
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
  if (process.env.OUTBOX_ENABLED !== 'true') {
    void publishPlatformModeInvalidation(cachedMode);
  }
}

/** Blocks non-admin traffic while maintenance mode is on. */
export async function assertNotMaintenance() {
  const mode = await getPlatformMode();
  if (mode.maintenanceEnabled) {
    throw new ApiError(503, 'MAINTENANCE', '서버 점검 중입니다. 잠시 후 다시 이용해 주세요.');
  }
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

type PlatformAliasWriter = {
  platformAlias: {
    createMany(args: Prisma.PlatformAliasCreateManyArgs): Promise<{ count: number }>;
  };
};

export function platformAliasRows(userIds: readonly string[], epoch: number) {
  return userIds.map((userId) => ({
    epoch,
    userId,
    alias: anonymousNickname(userId, epoch),
  }));
}

export function materializePlatformAliases(
  client: PlatformAliasWriter,
  epoch: number,
  userIds: readonly string[],
) {
  if (!userIds.length) return Promise.resolve({ count: 0 });
  return client.platformAlias.createMany({
    data: platformAliasRows(userIds, epoch),
    skipDuplicates: true,
  });
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
    // Shop cosmetics could help re-identify an anonymized user.
    if ('items' in source) result.items = [];
    if ('cosmetics' in source) result.cosmetics = null;
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
  const enriched = await enrichPublicUserTree(value);
  const mode = await getPlatformMode();
  if (!mode.bSideEnabled) return enriched;
  return maskIdentityTree(enriched, viewerId, mode) as T;
}

export async function maskPublicIdentitiesWithMode<T>(value: T, viewerId: string, mode: PlatformMode): Promise<T> {
  const enriched = await enrichPublicUserTree(value);
  if (!mode.bSideEnabled) return enriched;
  return maskIdentityTree(enriched, viewerId, mode) as T;
}
