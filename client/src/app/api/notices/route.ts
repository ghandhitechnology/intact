import { json, jsonError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';
import { readVisibleNotices } from '@/lib/server/notice-reads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const url = new URL(request.url);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 10) || 10));
    return json(await readVisibleNotices(session.user.id, session.user.studentIdentity?.grade, limit));
  } catch (error) {
    return jsonError(error);
  }
}
