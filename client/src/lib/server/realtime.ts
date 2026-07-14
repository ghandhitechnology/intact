import { secureStringEqual } from './crypto';

export function isRealtimeGatewayRequest(request: Request) {
  const expected = process.env.INTERNAL_API_SECRET;
  const supplied = request.headers.get('x-igwak-realtime-origin');
  return Boolean(expected && supplied && secureStringEqual(expected, supplied));
}

export async function publishRealtimeEvent(
  event: 'message' | 'room-created',
  payload: Record<string, unknown>,
) {
  const baseUrl = process.env.REALTIME_INTERNAL_URL;
  const secret = process.env.INTERNAL_API_SECRET;
  if (!baseUrl || !secret) return false;
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/internal/${event}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-igwak-internal': secret,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}
