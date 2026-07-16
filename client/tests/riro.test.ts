import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';
import { signRiroBridgeRequest } from '../src/lib/server/riro';

test('signs the exact serialized Riroschool bridge request', () => {
  const body = JSON.stringify({ id: 'student', password: 'not-logged' });
  const secret = 'a'.repeat(64);
  const timestamp = '1784190000';
  const nonce = 'nonce_value_1234567890';
  const bodyHash = createHash('sha256').update(body, 'utf8').digest('hex');
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${nonce}.${bodyHash}`, 'utf8')
    .digest('hex');
  assert.equal(signRiroBridgeRequest(body, secret, timestamp, nonce), expected);
});

test('signatures change when a credential request is modified', () => {
  const secret = 'b'.repeat(64);
  const timestamp = '1784190000';
  const nonce = 'nonce_value_1234567890';
  const first = signRiroBridgeRequest('{"id":"one","password":"pw"}', secret, timestamp, nonce);
  const second = signRiroBridgeRequest('{"id":"two","password":"pw"}', secret, timestamp, nonce);
  assert.notEqual(first, second);
});
