import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chatMessageEnvelope,
  compoundTimeCursor,
  messageRequestHash,
  monotonicReadSequence,
  parseChatCursor,
  sequenceCursor,
  serializeChatMessage,
} from '../src/lib/server/chat';

const messageId = '123e4567-e89b-42d3-a456-426614174000';

function requestIdentity(overrides: Partial<Parameters<typeof messageRequestHash>[0]> = {}) {
  return {
    roomId: 'room-a',
    senderId: 'sender-a',
    content: 'same message',
    replyToId: null,
    attachmentIds: ['attachment-b', 'attachment-a'],
    ...overrides,
  };
}

test('message request hashes bind idempotency to the persisted room and payload', () => {
  const expected = messageRequestHash(requestIdentity());
  assert.equal(
    expected,
    messageRequestHash(requestIdentity({ attachmentIds: ['attachment-a', 'attachment-b'] })),
    'attachment ordering is canonical',
  );
  assert.notEqual(expected, messageRequestHash(requestIdentity({ roomId: 'wrong-room' })));
  assert.notEqual(expected, messageRequestHash(requestIdentity({ content: 'changed' })));
  assert.notEqual(expected, messageRequestHash(requestIdentity({ replyToId: messageId })));
});

test('sequence and compound timestamp cursors round-trip without dropping equal timestamps', () => {
  assert.deepEqual(parseChatCursor(sequenceCursor(BigInt(42))), {
    kind: 'sequence',
    sequence: BigInt(42),
  });

  const createdAt = new Date('2026-07-16T10:11:12.123Z');
  const parsed = parseChatCursor(compoundTimeCursor(createdAt, messageId));
  assert.equal(parsed?.kind, 'compound');
  if (parsed?.kind === 'compound') {
    assert.equal(parsed.createdAt.toISOString(), createdAt.toISOString());
    assert.equal(parsed.id, messageId);
  }
  assert.deepEqual(parseChatCursor(createdAt.toISOString()), {
    kind: 'legacy-time',
    createdAt,
  });
});

test('read sequences never regress when stale receipts arrive later', () => {
  assert.equal(monotonicReadSequence(BigInt(12), BigInt(9)), BigInt(12));
  assert.equal(monotonicReadSequence(BigInt(12), BigInt(15)), BigInt(15));
  assert.equal(monotonicReadSequence(BigInt(12), BigInt(12)), BigInt(12));
});

test('message response contract is stable and BigInts are boundary-safe', () => {
  const serialized = serializeChatMessage({
    id: messageId,
    sequence: BigInt(7),
    attachments: [{ id: 'attachment-a', sizeBytes: BigInt(1024) }],
  });
  assert.deepEqual(chatMessageEnvelope(serialized, true), {
    message: {
      id: messageId,
      sequence: '7',
      attachments: [{ id: 'attachment-a', sizeBytes: '1024' }],
    },
    replayed: true,
  });
  assert.doesNotThrow(() => JSON.stringify(chatMessageEnvelope(serialized, false)));
});
