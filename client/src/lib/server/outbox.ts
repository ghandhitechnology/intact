import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

export type OutboxEventType =
  | 'realtime.message.requested'
  | 'realtime.room-created.requested'
  | 'platform.mode.changed'
  | 'notification.delivery.requested';

export type OutboxEventInput = {
  eventType: OutboxEventType;
  aggregateType?: string;
  aggregateId?: string;
  payload: Prisma.InputJsonValue;
  headers?: Prisma.InputJsonValue;
  dedupeKey: string;
  availableAt?: Date;
  maxAttempts?: number;
};

export type ClaimedOutboxEvent = {
  id: string;
  eventType: OutboxEventType;
  payload: Prisma.JsonValue;
  headers: Prisma.JsonValue | null;
  dedupeKey: string | null;
  attemptCount: number;
  maxAttempts: number;
  leaseToken: string;
};

type TransactionClient = Pick<Prisma.TransactionClient, '$executeRaw'>;

function jsonSafeValue(value: unknown, path: string): Prisma.InputJsonValue | null {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`Non-finite number at ${path}`);
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError(`Invalid date at ${path}`);
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (item === undefined) return null;
      return jsonSafeValue(item, `${path}[${index}]`);
    });
  }
  if (typeof value === 'object') {
    return jsonSafeObject(value as Record<string, unknown>, path);
  }
  throw new TypeError(`Unsupported JSON value at ${path}`);
}

function jsonSafeObject(value: Record<string, unknown>, path: string): Prisma.InputJsonObject {
  const result: Record<string, Prisma.InputJsonValue | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) result[key] = jsonSafeValue(item, `${path}.${key}`);
  }
  return result;
}

/** Convert a payload to the exact JSON value that will be persisted in the outbox. */
export function toOutboxJson(value: Record<string, unknown>): Prisma.InputJsonObject {
  return jsonSafeObject(value, '$');
}

function validEventType(eventType: string): eventType is OutboxEventType {
  return eventType === 'realtime.message.requested'
    || eventType === 'realtime.room-created.requested'
    || eventType === 'platform.mode.changed'
    || eventType === 'notification.delivery.requested';
}

export function outboxRetryDelayMs(attemptCount: number) {
  const exponent = Math.max(0, Math.min(10, attemptCount - 1));
  return Math.min(15 * 60_000, 1_000 * (2 ** exponent));
}

/** Insert this with the domain mutation's Prisma transaction for atomic publication. */
export async function writeOutboxEvent(tx: TransactionClient, input: OutboxEventInput) {
  if (!validEventType(input.eventType)) throw new Error(`Unsupported outbox event: ${input.eventType}`);
  if (!input.dedupeKey || input.dedupeKey.length > 160) {
    throw new Error('Outbox dedupeKey must be 1-160 characters');
  }
  if ((input.aggregateType?.length ?? 0) > 80 || (input.aggregateId?.length ?? 0) > 100) {
    throw new Error('Outbox aggregate metadata is too long');
  }
  const maxAttempts = Math.max(1, Math.min(100, Math.floor(input.maxAttempts ?? 10)));
  const id = randomUUID();
  const payload = JSON.stringify(input.payload);
  const headers = input.headers === undefined
    ? Prisma.sql`NULL`
    : Prisma.sql`${JSON.stringify(input.headers)}::jsonb`;
  const inserted = await tx.$executeRaw(Prisma.sql`
    INSERT INTO "OutboxEvent" (
      "id", "createdAt", "updatedAt", "eventType", "aggregateType", "aggregateId",
      "payload", "headers", "dedupeKey", "availableAt", "attemptCount", "maxAttempts"
    ) VALUES (
      ${id}::uuid, NOW(), NOW(), ${input.eventType}, ${input.aggregateType ?? null},
      ${input.aggregateId ?? null}, ${payload}::jsonb, ${headers}, ${input.dedupeKey},
      ${input.availableAt ?? new Date()}, 0, ${maxAttempts}
    )
    ON CONFLICT ("dedupeKey") DO NOTHING
  `);
  return { id, inserted: inserted === 1 };
}

export async function claimOutboxEvents(
  prisma: PrismaClient,
  options: { limit?: number; leaseMs?: number } = {},
): Promise<ClaimedOutboxEvent[]> {
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 20)));
  const leaseMs = Math.max(5_000, Math.min(10 * 60_000, Math.floor(options.leaseMs ?? 60_000)));
  const leaseToken = randomUUID();
  const rows = await prisma.$transaction(async (tx) => tx.$queryRaw<Array<{
    id: string;
    eventType: string;
    payload: Prisma.JsonValue;
    headers: Prisma.JsonValue | null;
    dedupeKey: string | null;
    attemptCount: number;
    maxAttempts: number;
    leaseToken: string;
  }>>(Prisma.sql`
    WITH candidates AS (
      SELECT "id"
      FROM "OutboxEvent"
      WHERE "publishedAt" IS NULL
        AND "availableAt" <= NOW()
        AND "attemptCount" < "maxAttempts"
        AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < NOW())
        AND "eventType" IN (
          'realtime.message.requested',
          'realtime.room-created.requested',
          'platform.mode.changed',
          'notification.delivery.requested'
        )
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE "OutboxEvent" AS event
    SET "updatedAt" = NOW(),
        "leaseToken" = ${leaseToken}::uuid,
        "leaseExpiresAt" = NOW() + (${leaseMs} * INTERVAL '1 millisecond'),
        "attemptCount" = event."attemptCount" + 1
    FROM candidates
    WHERE event."id" = candidates."id"
    RETURNING event."id", event."eventType", event."payload", event."headers",
      event."dedupeKey", event."attemptCount", event."maxAttempts", event."leaseToken"
  `));

  return rows.map((row) => {
    if (!validEventType(row.eventType)) throw new Error(`Unsupported claimed outbox event: ${row.eventType}`);
    return { ...row, eventType: row.eventType };
  });
}

export async function completeOutboxEvent(
  prisma: PrismaClient,
  event: Pick<ClaimedOutboxEvent, 'id' | 'leaseToken'>,
) {
  return prisma.$executeRaw(Prisma.sql`
    UPDATE "OutboxEvent"
    SET "updatedAt" = NOW(), "publishedAt" = NOW(), "leaseToken" = NULL,
        "leaseExpiresAt" = NULL, "lastError" = NULL
    WHERE "id" = ${event.id}::uuid
      AND "leaseToken" = ${event.leaseToken}::uuid
      AND "publishedAt" IS NULL
  `);
}

export async function retryOutboxEvent(
  prisma: PrismaClient,
  event: Pick<ClaimedOutboxEvent, 'id' | 'attemptCount' | 'leaseToken'>,
  error: unknown,
) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
  const availableAt = new Date(Date.now() + outboxRetryDelayMs(event.attemptCount));
  return prisma.$executeRaw(Prisma.sql`
    UPDATE "OutboxEvent"
    SET "updatedAt" = NOW(), "availableAt" = ${availableAt}, "leaseToken" = NULL,
        "leaseExpiresAt" = NULL, "lastError" = ${message}
    WHERE "id" = ${event.id}::uuid
      AND "leaseToken" = ${event.leaseToken}::uuid
      AND "publishedAt" IS NULL
  `);
}
