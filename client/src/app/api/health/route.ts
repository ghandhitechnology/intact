import prisma from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json(
      { status: 'ok', database: 'connected', timestamp: new Date().toISOString() },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { status: 'unhealthy', database: 'disconnected', timestamp: new Date().toISOString() },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
