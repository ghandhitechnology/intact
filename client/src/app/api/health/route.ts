import { requestId } from '@/lib/request-id';
import prisma from '@/lib/prisma';
import { logStructuredError } from '@/lib/server/observability';
import { getRedisClient } from '@/lib/server/redis';
import { secureStringEqual } from '@/lib/server/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type HealthResult = {
  healthy: boolean;
  databaseCheck: { status: 'connected' | 'disconnected'; latencyMs: number };
  redisCheck: { status: 'connected' | 'disconnected' | 'not_configured'; latencyMs: number };
};

let cachedHealth: { value: HealthResult; expiresAt: number } | null = null;
let pendingHealth: Promise<HealthResult> | null = null;

async function checkDependencies(id: string): Promise<HealthResult> {
  const databaseStartedAt = performance.now();
  const databaseCheck = await prisma.$queryRaw`SELECT 1`
    .then(() => ({
      status: 'connected' as const,
      latencyMs: Math.round(performance.now() - databaseStartedAt),
    }))
    .catch((error: unknown) => {
      const latencyMs = Math.round(performance.now() - databaseStartedAt);
      logStructuredError('health.database_unavailable', error, { requestId: id, latencyMs });
      return { status: 'disconnected' as const, latencyMs };
    });

  const redisConfigured = Boolean(process.env.REDIS_URL?.trim());
  const redisStartedAt = performance.now();
  const redisCheck = redisConfigured
    ? await getRedisClient()
      .then(async (client) => {
        if (!client) throw new Error('Redis client unavailable');
        await client.ping();
        return {
          status: 'connected' as const,
          latencyMs: Math.round(performance.now() - redisStartedAt),
        };
      })
      .catch((error: unknown) => {
        const latencyMs = Math.round(performance.now() - redisStartedAt);
        logStructuredError('health.redis_unavailable', error, { requestId: id, latencyMs });
        return { status: 'disconnected' as const, latencyMs };
      })
    : { status: 'not_configured' as const, latencyMs: 0 };

  const healthy = databaseCheck.status === 'connected'
    && redisCheck.status !== 'disconnected';
  return { healthy, databaseCheck, redisCheck };
}

async function dependencyHealth(id: string) {
  const now = Date.now();
  if (cachedHealth && cachedHealth.expiresAt > now) return cachedHealth.value;
  if (pendingHealth) return pendingHealth;
  pendingHealth = checkDependencies(id)
    .then((value) => {
      cachedHealth = { value, expiresAt: Date.now() + 2_000 };
      return value;
    })
    .finally(() => {
      pendingHealth = null;
    });
  return pendingHealth;
}

export async function GET(request: Request) {
  const id = requestId(request.headers.get('x-request-id'));
  const { healthy, databaseCheck, redisCheck } = await dependencyHealth(id);
  const suppliedSecret = request.headers.get('x-igwak-internal');
  const expectedSecret = process.env.INTERNAL_API_SECRET;
  const detailed = Boolean(
    expectedSecret
    && suppliedSecret
    && secureStringEqual(expectedSecret, suppliedSecret),
  );
  return Response.json(
    {
      status: healthy ? 'ok' : 'unhealthy',
      ...(detailed
        ? {
            checks: { database: databaseCheck, redis: redisCheck },
            uptimeSeconds: Math.round(process.uptime()),
            timestamp: new Date().toISOString(),
          }
        : {}),
    },
    {
      status: healthy ? 200 : 503,
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': id },
    },
  );
}
