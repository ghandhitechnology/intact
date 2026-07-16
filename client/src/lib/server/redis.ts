import { createClient, type RedisClientType } from 'redis';

type Client = RedisClientType;

type RedisState = {
  client: Client | null;
  connecting: Promise<Client | null> | null;
  subscribers: Set<Client>;
  closing: boolean;
};

const stateKey = Symbol.for('intact.redis.state');
const globalState = globalThis as typeof globalThis & { [stateKey]?: RedisState };
const state = globalState[stateKey] ??= {
  client: null,
  connecting: null,
  subscribers: new Set<Client>(),
  closing: false,
};

function redisUrl() {
  const value = process.env.REDIS_URL?.trim();
  return value || null;
}

function reportRedisError(scope: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[redis:${scope}] ${message.slice(0, 500)}`);
}

/** Returns a connected process-wide client, or null when Redis is not configured/unavailable. */
export async function getRedisClient(): Promise<Client | null> {
  if (state.closing) return null;
  if (state.client?.isReady) return state.client;
  if (state.connecting) return state.connecting;

  const url = redisUrl();
  if (!url) return null;

  const client = createClient({
    url,
    socket: {
      connectTimeout: 3_000,
      reconnectStrategy: (retries) => retries >= 3
        ? new Error('Redis reconnect limit reached')
        : Math.min(100 * (2 ** retries), 1_000),
    },
  });
  client.on('error', (error) => reportRedisError('client', error));

  state.connecting = client.connect()
    .then(() => {
      if (state.closing) {
        void client.quit().catch(() => client.disconnect());
        return null;
      }
      state.client = client as Client;
      return state.client;
    })
    .catch((error) => {
      reportRedisError('connect', error);
      if (client.isOpen) client.disconnect();
      return null;
    })
    .finally(() => {
      state.connecting = null;
    });
  return state.connecting;
}

/** Creates a dedicated lazy subscriber; callers own the returned unsubscribe lifecycle. */
export async function subscribeRedis(
  channel: string,
  listener: (message: string, channel: string) => void,
): Promise<(() => Promise<void>) | null> {
  const base = await getRedisClient();
  if (!base || state.closing) return null;

  const subscriber = base.duplicate() as Client;
  subscriber.on('error', (error) => reportRedisError(`subscriber:${channel}`, error));
  try {
    await subscriber.connect();
    await subscriber.subscribe(channel, listener);
    state.subscribers.add(subscriber);
  } catch (error) {
    reportRedisError(`subscribe:${channel}`, error);
    if (subscriber.isOpen) subscriber.disconnect();
    return null;
  }

  return async () => {
    state.subscribers.delete(subscriber);
    if (!subscriber.isOpen) return;
    await subscriber.unsubscribe(channel).catch(() => undefined);
    await subscriber.quit().catch(() => subscriber.disconnect());
  };
}

export async function closeRedis() {
  state.closing = true;
  await state.connecting?.catch(() => null);
  const subscribers = Array.from(state.subscribers);
  state.subscribers.clear();
  await Promise.all(subscribers.map(async (subscriber) => {
    if (subscriber.isOpen) await subscriber.quit().catch(() => subscriber.disconnect());
  }));
  const client = state.client;
  state.client = null;
  if (client?.isOpen) await client.quit().catch(() => client.disconnect());
}
