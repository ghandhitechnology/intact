import crypto from 'node:crypto';
import { getGatewayRedisClient } from './redis';

const localDone = new Map<string, number>();
const localInFlight = new Set<string>();
const DONE_TTL_SECONDS = 24 * 60 * 60;
const LOCK_TTL_MS = 30_000;

export type DeliveryClaim = {
  eventId: string;
  token: string;
  source: 'redis' | 'memory';
};

const CLAIM_LUA = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
if redis.call('SET', KEYS[2], ARGV[1], 'NX', 'PX', ARGV[2]) then return 1 end
return 2
`;

const COMPLETE_LUA = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], '1', 'EX', ARGV[2])
redis.call('DEL', KEYS[2])
return 1
`;

const ABANDON_LUA = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
`;

function keys(eventId: string) {
  return {
    done: `intact:delivery:done:${eventId}`,
    lock: `intact:delivery:lock:${eventId}`,
  };
}

function pruneLocal(now = Date.now()) {
  if (localDone.size < 1_000) return;
  for (const [eventId, expiresAt] of localDone) {
    if (expiresAt <= now) localDone.delete(eventId);
  }
}

/** null means already delivered; throws when another gateway is currently delivering it. */
export async function claimEventDelivery(eventId: string): Promise<DeliveryClaim | null> {
  if (!eventId || eventId.length > 160) throw new Error('INVALID_EVENT_ID');
  const token = crypto.randomUUID();
  const client = getGatewayRedisClient();
  if (client) {
    const key = keys(eventId);
    const result = Number(await client.eval(CLAIM_LUA, {
      keys: [key.done, key.lock],
      arguments: [token, String(LOCK_TTL_MS)],
    }));
    if (result === 0) return null;
    if (result === 2) throw new Error('EVENT_DELIVERY_BUSY');
    return { eventId, token, source: 'redis' };
  }

  pruneLocal();
  if ((localDone.get(eventId) ?? 0) > Date.now()) return null;
  if (localInFlight.has(eventId)) throw new Error('EVENT_DELIVERY_BUSY');
  localInFlight.add(eventId);
  return { eventId, token, source: 'memory' };
}

export async function completeEventDelivery(claim: DeliveryClaim) {
  if (claim.source === 'memory') {
    localInFlight.delete(claim.eventId);
    localDone.set(claim.eventId, Date.now() + DONE_TTL_SECONDS * 1_000);
    return;
  }
  const client = getGatewayRedisClient();
  if (!client) return;
  const key = keys(claim.eventId);
  await client.eval(COMPLETE_LUA, {
    keys: [key.done, key.lock],
    arguments: [claim.token, String(DONE_TTL_SECONDS)],
  });
}

export async function abandonEventDelivery(claim: DeliveryClaim) {
  if (claim.source === 'memory') {
    localInFlight.delete(claim.eventId);
    return;
  }
  const client = getGatewayRedisClient();
  if (!client) return;
  const key = keys(claim.eventId);
  await client.eval(ABANDON_LUA, {
    keys: [key.lock],
    arguments: [claim.token],
  });
}
