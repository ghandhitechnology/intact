import { jsonError } from '@/lib/server/http';
import { requireAdmin } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Lightweight admin-session probe used by the middleware to let real
 * administrators bypass maintenance mode. Cookie presence alone is never
 * trusted; this endpoint verifies the session against the database.
 */
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}
