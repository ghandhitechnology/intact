import type { Prisma } from '@prisma/client';
import { secureStringEqual } from './crypto';
import { writeOutboxEvent } from './outbox';

export type RealtimeEvent = 'message' | 'room-created';

export function isRealtimeGatewayRequest(request: Request) {
  const expected = process.env.INTERNAL_API_SECRET;
  const supplied = request.headers.get('x-igwak-realtime-origin');
  return Boolean(expected && supplied && secureStringEqual(expected, supplied));
}

export function outboxPublicationEnabled() {
  return process.env.OUTBOX_ENABLED === 'true';
}

export function directPublicationEnabled() {
  if (!outboxPublicationEnabled()) return true;
  return process.env.REALTIME_DIRECT_PUBLISH_FALLBACK === 'true';
}

/** Call inside the same transaction that creates the message/room. */
export function queueRealtimeEvent(
  tx: Prisma.TransactionClient,
  event: RealtimeEvent,
  payload: Prisma.InputJsonValue,
  dedupeKey: string,
) {
  return writeOutboxEvent(tx, {
    eventType: event === 'message'
      ? 'realtime.message.requested'
      : 'realtime.room-created.requested',
    aggregateType: event === 'message' ? 'Message' : 'ChatRoom',
    payload,
    dedupeKey,
  });
}

/** HTTP delivery used by both legacy direct publication and the outbox worker. */
export async function deliverRealtimeEvent(
  event: RealtimeEvent,
  payload: Record<string, unknown>,
  options: { eventId?: string } = {},
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
        ...(options.eventId ? { 'x-igwak-event-id': options.eventId } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Compatibility path for callers not yet moved into an outbox transaction.
 * It stays on by default and turns off only when OUTBOX_ENABLED=true, unless
 * REALTIME_DIRECT_PUBLISH_FALLBACK=true explicitly keeps dual publication.
 */
export async function publishRealtimeEvent(
  event: RealtimeEvent,
  payload: Record<string, unknown>,
) {
  if (!directPublicationEnabled()) return false;
  return deliverRealtimeEvent(event, payload);
}
