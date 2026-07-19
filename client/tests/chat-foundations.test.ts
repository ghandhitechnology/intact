import assert from 'node:assert/strict';
import test from 'node:test';
import {
  messageRequestHash,
  parseChatCursor,
  sequenceCursor,
} from '../src/lib/server/chat';

const ROOM_ID = '11111111-1111-4111-8111-111111111111';
const SENDER_ID = '22222222-2222-4222-8222-222222222222';
const MESSAGE_ID = '33333333-3333-4333-8333-333333333333';
const ATTACHMENT_ID = '44444444-4444-4444-8444-444444444444';

function identity(overrides: Partial<Parameters<typeof messageRequestHash>[0]> = {}) {
  return {
    roomId: ROOM_ID,
    senderId: SENDER_ID,
    content: '동일한 요청 본문',
    replyToId: null,
    attachmentIds: [ATTACHMENT_ID],
    ...overrides,
  };
}

test('message request hashes also bind sender identity and the attachment set', () => {
  const baseline = messageRequestHash(identity());
  assert.notEqual(baseline, messageRequestHash(identity({ senderId: MESSAGE_ID })));
  assert.notEqual(baseline, messageRequestHash(identity({ attachmentIds: [] })));
});

test('sequence cursors retain bigint values beyond Number safe-integer precision', () => {
  const sequence = BigInt('9007199254740993');
  assert.deepEqual(parseChatCursor(sequenceCursor(sequence)), { kind: 'sequence', sequence });
});

test('chat cursors reject malformed and ambiguous values instead of using permissive Date parsing', () => {
  const malformed = [
    '-1',
    '01',
    'seq:',
    'seq:1.5',
    'not-a-date',
    '2026-07-17T01:02:03.456Z|not-a-message-id',
  ];

  for (const value of malformed) assert.equal(parseChatCursor(value), null, value);
});
