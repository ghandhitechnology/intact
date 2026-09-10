import { json, jsonError } from '@/lib/server/http';
import { loadHomeData } from '@/lib/server/home-service';
import { createHomeLoaders } from '@/lib/server/home-reads';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const payload = await loadHomeData({
      request,
      currentIgk: session.user.currentIgk,
      loaders: createHomeLoaders(session),
    });
    return json(payload);
  } catch (error) {
    return jsonError(error);
  }
}
