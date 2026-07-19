import { assertSameOrigin, enforceClientIpRateLimit, json, jsonError, readJson } from '@/lib/server/http';

export const runtime = 'nodejs';

const ALLOWED_NAMES = new Set(['TTFB', 'FCP', 'LCP', 'FID', 'CLS', 'INP', 'Next.js-hydration', 'Next.js-route-change-to-render', 'Next.js-render']);

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    enforceClientIpRateLimit(request, 'web-vitals', { limit: 120, windowMs: 60 * 60_000 });
    const body = await readJson<Record<string, unknown>>(request, 4_096);
    const name = typeof body.name === 'string' && ALLOWED_NAMES.has(body.name) ? body.name : 'unknown';
    const value = Number(body.value);
    const delta = Number(body.delta);
    const path = typeof body.path === 'string' && body.path.startsWith('/') ? body.path.slice(0, 180) : '/';
    if (!Number.isFinite(value) || !Number.isFinite(delta)) return json({ accepted: false }, 202);
    console.info('[web-vital]', JSON.stringify({
      name,
      value: Math.round(value * 1000) / 1000,
      delta: Math.round(delta * 1000) / 1000,
      rating: typeof body.rating === 'string' ? body.rating.slice(0, 24) : null,
      navigationType: typeof body.navigationType === 'string' ? body.navigationType.slice(0, 32) : null,
      path,
    }));
    return json({ accepted: true }, 202);
  } catch (error) {
    return jsonError(error);
  }
}
