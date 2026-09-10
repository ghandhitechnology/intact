import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHAT_MAX_OTHER_MEMBERS,
  CHAT_ROOM_CAPACITY,
  chatTooManyMembersMessage,
  takeCompletedParticipantCodes,
} from '../src/lib/chat-limits';

test('class-sized rooms keep a single capacity constant', () => {
  assert.equal(CHAT_MAX_OTHER_MEMBERS, 20);
  assert.equal(CHAT_ROOM_CAPACITY, 21);
  assert.match(chatTooManyMembersMessage(), /20/);
});

test('participant chips split completed codes and keep the unfinished token', () => {
  assert.deepEqual(takeCompletedParticipantCodes('331108, 331203 '), {
    completed: ['331108', '331203'],
    rest: '',
  });
  assert.deepEqual(takeCompletedParticipantCodes('331108, 33'), {
    completed: ['331108'],
    rest: '33',
  });
});
