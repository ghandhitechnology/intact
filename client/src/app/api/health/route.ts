import { requestId } from '@/lib/request-id';
import prisma from '@/lib/prisma';
import { logStructuredError } from '@/lib/server/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const id = requestId(request.headers.get('x-request-id'));
  const startedAt = performance.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json(
      {
        status: 'ok',
        checks: { database: { status: 'connected', latencyMs: Math.round(performance.now() - startedAt) } },
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store', 'X-Request-ID': id } },
    );
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);
    logStructuredError('health.database_unavailable', error, { requestId: id, latencyMs });
    return Response.json(
      {
        status: 'unhealthy',
        checks: { database: { status: 'disconnected', latencyMs } },
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Request-ID': id } },
    );
  }
}
