import assert from 'node:assert/strict';
import test from 'node:test';
import { loginPasswordError } from '../src/lib/login-credentials';

test('login accepts non-empty legacy passwords shorter than the current creation policy', () => {
  assert.equal(loginPasswordError('shortpw'), null);
});

test('login still rejects missing and oversized passwords', () => {
  assert.equal(loginPasswordError(''), '비밀번호를 입력해 주세요.');
  assert.equal(loginPasswordError('x'.repeat(129)), '비밀번호는 128자 이하여야 합니다.');
});
