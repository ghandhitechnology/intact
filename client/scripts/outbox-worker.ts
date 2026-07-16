import { PrismaClient, type Prisma } from '@prisma/client';
import { materializeDueNotices } from '../src/lib/server/notices';
import {
  claimOutboxEvents,
  completeOutboxEvent,
  retryOutboxEvent,
  type ClaimedOutboxEvent,
} from '../src/lib/server/outbox';
import { publishPlatformInvalidationMessage } from '../src/lib/server/platform-mode';
import { deliverNotificationPush } from '../src/lib/server/push';
import { closeRedis } from '../src/lib/server/redis';
import { deliverRealtimeEvent } from '../src/lib/server/realtime';

const prisma = new PrismaClient();
const workerId = `outbox-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const pollMs = Math.max(100, Number(process.env.OUTBOX_POLL_MS || 1_000));
const noticeIntervalMs = Math.max(5_000, Number(process.env.NOTICE_SCHEDULER_INTERVAL_MS || 15_000));
let stopping = false;
let nextNoticeRun = 0;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function recordPayload(value: Prisma.JsonValue): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('Outbox payload must be a JSON object');
  }
  return value as Record<string, unknown>;
}

async function dispatch(event: ClaimedOutboxEvent) {
  const payload = recordPayload(event.payload);
  if (event.eventType === 'realtime.message.requested') {
    if (!await deliverRealtimeEvent('message', payload, { eventId: event.id })) {
      throw new Error('Realtime message delivery failed');
    }
    return;
  }
  if (event.eventType === 'realtime.room-created.requested') {
    if (!await deliverRealtimeEvent('room-created', payload, { eventId: event.id })) {
      throw new Error('Realtime room delivery failed');
    }
    return;
  }
  if (event.eventType === 'notification.delivery.requested') {
    if (typeof payload.userId !== 'string' || typeof payload.type !== 'string') {
      throw new Error('Invalid notification delivery payload');
    }
    await deliverNotificationPush(prisma, {
      userId: payload.userId,
      type: payload.type,
      notificationId: typeof payload.notificationId === 'string' ? payload.notificationId : null,
      href: typeof payload.href === 'string' ? payload.href : null,
      mandatory: payload.mandatory === true,
    });
    return;
  }
  if (event.eventType === 'platform.mode.changed') {
    if (
      typeof payload.version !== 'string'
      || typeof payload.bSideEnabled !== 'boolean'
      || typeof payload.maintenanceEnabled !== 'boolean'
    ) {
      throw new Error('Invalid platform invalidation payload');
    }
    if (!await publishPlatformInvalidationMessage({
      version: payload.version,
      bSideEnabled: payload.bSideEnabled,
      maintenanceEnabled: payload.maintenanceEnabled,
    })) {
      throw new Error('Platform invalidation publication failed');
    }
  }
}

async function processEvent(event: ClaimedOutboxEvent) {
  try {
    await dispatch(event);
    const updated = await completeOutboxEvent(prisma, event);
    if (updated !== 1) throw new Error('Outbox lease was lost before completion');
  } catch (error) {
    await retryOutboxEvent(prisma, event, error);
  }
}

async function runNoticeScheduler() {
  if (Date.now() < nextNoticeRun) return;
  nextNoticeRun = Date.now() + noticeIntervalMs;
  try {
    await materializeDueNotices(new Date(), { source: 'worker' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${workerId}] notice scheduler: ${message.slice(0, 500)}`);
  }
}

async function main() {
  console.info(`[${workerId}] outbox worker started`);
  while (!stopping) {
    await runNoticeScheduler();
    const events = await claimOutboxEvents(prisma, { limit: 20, leaseMs: 60_000 });
    if (!events.length) {
      await sleep(pollMs);
      continue;
    }
    await Promise.all(events.map(processEvent));
  }
}

async function shutdown(signal: string, exitCode = 0) {
  if (stopping) return;
  stopping = true;
  console.info(`[${workerId}] stopping after ${signal}`);
  await Promise.allSettled([prisma.$disconnect(), closeRedis()]);
  process.exit(exitCode);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${workerId}] fatal: ${message.slice(0, 1_000)}`);
  void shutdown('fatal', 1);
});
