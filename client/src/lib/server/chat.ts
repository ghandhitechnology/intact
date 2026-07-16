import { createHash } from 'node:crypto';

export type ChatCursor =
  | { kind: 'sequence'; sequence: bigint }
  | { kind: 'compound'; createdAt: Date; id: string }
  | { kind: 'legacy-time'; createdAt: Date };

const DECIMAL_SEQUENCE = /^(?:seq:)?(0|[1-9]\d*)$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const MESSAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseChatCursor(value: string | null | undefined): ChatCursor | null {
  const normalized = value?.trim();
  if (!normalized) return null;

  const sequence = DECIMAL_SEQUENCE.exec(normalized);
  if (sequence) return { kind: 'sequence', sequence: BigInt(sequence[1]) };

  const separator = normalized.lastIndexOf('|');
  if (separator > 0) {
    const createdAtValue = normalized.slice(0, separator);
    const createdAt = new Date(createdAtValue);
    const id = normalized.slice(separator + 1);
    if (ISO_TIMESTAMP.test(createdAtValue) && !Number.isNaN(createdAt.getTime()) && MESSAGE_ID.test(id)) {
      return { kind: 'compound', createdAt, id };
    }
    return null;
  }

  if (!ISO_TIMESTAMP.test(normalized)) return null;
  const createdAt = new Date(normalized);
  return Number.isNaN(createdAt.getTime()) ? null : { kind: 'legacy-time', createdAt };
}

export function sequenceCursor(sequence: bigint | number | string) {
  return `seq:${BigInt(sequence).toString()}`;
}

export function compoundTimeCursor(createdAt: Date, id: string) {
  return `${createdAt.toISOString()}|${id}`;
}

export interface MessageRequestIdentity {
  roomId: string;
  senderId: string;
  content: string;
  replyToId: string | null;
  attachmentIds: readonly string[];
}

export function messageRequestHash(input: MessageRequestIdentity) {
  const canonical = JSON.stringify({
    roomId: input.roomId,
    senderId: input.senderId,
    content: input.content,
    replyToId: input.replyToId,
    attachmentIds: [...input.attachmentIds].sort(),
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function monotonicReadSequence(current: bigint, requested: bigint) {
  return requested > current ? requested : current;
}

export function chatMessageEnvelope<T>(message: T, replayed: boolean) {
  return { message, replayed } as const;
}

export function serializeChatMessage<
  T extends {
    sequence: bigint;
    attachments?: readonly ({ sizeBytes?: bigint } & Record<string, unknown>)[];
  },
>(message: T) {
  return {
    ...message,
    sequence: message.sequence.toString(),
    ...(message.attachments
      ? {
          attachments: message.attachments.map((attachment) => ({
            ...attachment,
            ...(typeof attachment.sizeBytes === 'bigint'
              ? { sizeBytes: attachment.sizeBytes.toString() }
              : {}),
          })),
        }
      : {}),
  };
}
