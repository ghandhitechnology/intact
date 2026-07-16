import { requestId } from '@/lib/request-id';
import prisma from '@/lib/prisma';
import { logStructuredError } from '@/lib/server/observability';
import { getRedisClient } from '@/lib/server/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const id = requestId(request.headers.get('x-request-id'));
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
  return Response.json(
    {
      status: healthy ? 'ok' : 'unhealthy',
      checks: { database: databaseCheck, redis: redisCheck },
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
    {
      status: healthy ? 200 : 503,
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': id },
    },
  );
}
