import { getRedisClient } from './redis';

const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local capacity = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])
local values = redis.call('HMGET', key, 'tokens', 'updated')
local tokens = tonumber(values[1]) or capacity
local updated = tonumber(values[2]) or now
if now > updated then
  tokens = math.min(capacity, tokens + ((now - updated) * rate / 1000))
end
local allowed = 0
local retry = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retry = math.ceil((cost - tokens) * 1000 / rate)
end
redis.call('HSET', key, 'tokens', tokens, 'updated', now)
redis.call('PEXPIRE', key, ttl)
return { allowed, math.floor(tokens), retry }
`;

export type RateLimitFailPolicy = 'open' | 'closed';

export type TokenBucketOptions = {
  key: string;
  capacity: number;
  refillPerSecond: number;
  cost?: number;
  failPolicy: RateLimitFailPolicy;
  nowMs?: number;
};

export type TokenBucketResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  source: 'redis' | 'fail-open' | 'fail-closed';
};

type EvalClient = {
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
};

function positiveFinite(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
  return value;
}

function fallback(policy: RateLimitFailPolicy, capacity: number): TokenBucketResult {
  return policy === 'open'
    ? { allowed: true, remaining: capacity, retryAfterMs: 0, source: 'fail-open' }
    : { allowed: false, remaining: 0, retryAfterMs: 1_000, source: 'fail-closed' };
}

/** Atomic distributed token bucket. Every caller must choose its Redis failure policy. */
export async function consumeRedisTokenBucket(
  options: TokenBucketOptions,
  injectedClient?: EvalClient | null,
): Promise<TokenBucketResult> {
  const capacity = positiveFinite(options.capacity, 'capacity');
  const refillPerSecond = positiveFinite(options.refillPerSecond, 'refillPerSecond');
  const cost = positiveFinite(options.cost ?? 1, 'cost');
  if (!options.key || options.key.length > 200) throw new Error('key must be 1-200 characters');
  if (cost > capacity) throw new Error('cost cannot exceed capacity');

  const client = injectedClient === undefined ? await getRedisClient() : injectedClient;
  if (!client) return fallback(options.failPolicy, capacity);

  const ttlMs = Math.max(1_000, Math.ceil((capacity / refillPerSecond) * 2_000));
  try {
    const raw = await client.eval(TOKEN_BUCKET_LUA, {
      keys: [`intact:rate-limit:${options.key}`],
      arguments: [
        String(Math.floor(options.nowMs ?? Date.now())),
        String(refillPerSecond),
        String(capacity),
        String(cost),
        String(ttlMs),
      ],
    });
    if (!Array.isArray(raw) || raw.length !== 3) throw new Error('invalid token bucket response');
    return {
      allowed: Number(raw[0]) === 1,
      remaining: Math.max(0, Number(raw[1]) || 0),
      retryAfterMs: Math.max(0, Number(raw[2]) || 0),
      source: 'redis',
    };
  } catch {
    return fallback(options.failPolicy, capacity);
  }
}
