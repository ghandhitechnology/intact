import { createAdapter } from '@socket.io/redis-adapter';
import { createClient, type RedisClientType } from 'redis';
import type { Server } from 'socket.io';

export const PLATFORM_INVALIDATION_CHANNEL = 'intact:platform:invalidate:v1';

type Client = RedisClientType;
type RedisStatus = 'disabled' | 'connecting' | 'ready' | 'degraded';

let commandClient: Client | null = null;
let publisher: Client | null = null;
let subscriber: Client | null = null;
let platformSubscriber: Client | null = null;
let status: RedisStatus = 'disabled';

function logError(scope: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[redis:${scope}] ${message.slice(0, 500)}\n`);
}

function makeClient(url: string, scope: string) {
  const client = createClient({
    url,
    socket: {
      connectTimeout: 3_000,
      reconnectStrategy: (retries) => retries >= 3
        ? new Error('Redis reconnect limit reached')
        : Math.min(100 * (2 ** retries), 1_000),
    },
  });
  client.on('error', (error) => logError(scope, error));
  return client as Client;
}

export function gatewayRedisStatus() {
  return status;
}

export function getGatewayRedisClient() {
  return commandClient?.isReady ? commandClient : null;
}

export async function initializeGatewayRedis(
  io: Server,
  onPlatformInvalidation: (message: string) => void,
) {
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    status = 'disabled';
    if (process.env.REDIS_REQUIRED === 'true') throw new Error('REDIS_URL is required');
    return false;
  }

  status = 'connecting';
  const clients = {
    command: makeClient(url, 'command'),
    publisher: makeClient(url, 'adapter-publisher'),
    subscriber: makeClient(url, 'adapter-subscriber'),
    platform: makeClient(url, 'platform-subscriber'),
  };
  try {
    await Promise.all(Object.values(clients).map((client) => client.connect()));
    commandClient = clients.command;
    publisher = clients.publisher;
    subscriber = clients.subscriber;
    platformSubscriber = clients.platform;
    io.adapter(createAdapter(publisher, subscriber));
    await platformSubscriber.subscribe(PLATFORM_INVALIDATION_CHANNEL, onPlatformInvalidation);
    status = 'ready';
    return true;
  } catch (error) {
    status = 'degraded';
    logError('initialize', error);
    await Promise.all(Object.values(clients).map(async (client) => {
      if (client.isOpen) await client.quit().catch(() => client.disconnect());
    }));
    commandClient = null;
    publisher = null;
    subscriber = null;
    platformSubscriber = null;
    if (process.env.REDIS_REQUIRED === 'true') throw error;
    return false;
  }
}

export async function closeGatewayRedis() {
  const clients = [platformSubscriber, subscriber, publisher, commandClient]
    .filter((client): client is Client => Boolean(client));
  platformSubscriber = null;
  subscriber = null;
  publisher = null;
  commandClient = null;
  status = 'disabled';
  await Promise.all(clients.map(async (client) => {
    if (client.isOpen) await client.quit().catch(() => client.disconnect());
  }));
}
