import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ContractParseError,
  expectArray,
  expectFiniteNumber,
  expectRecord,
  expectString,
  parseApiFailure,
} from '../src/lib/contracts/runtime';
import { ApiError, readJson } from '../src/lib/server/http';

test('JSON body parsing enforces content type, syntax, and actual byte limits', async () => {
  const valid = new Request('https://portal.example/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ value: '정상' }),
  });
  assert.deepEqual(await readJson(valid), { value: '정상' });

  const wrongType = new Request('https://portal.example/api', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{}',
  });
  await assert.rejects(() => readJson(wrongType), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    return error.status === 415 && error.code === 'UNSUPPORTED_MEDIA_TYPE';
  });

  const invalid = new Request('https://portal.example/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
  await assert.rejects(() => readJson(invalid), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    return error.status === 400 && error.code === 'INVALID_JSON';
  });

  const oversized = new Request('https://portal.example/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: '1234567890' }),
  });
  await assert.rejects(() => readJson(oversized, 8), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    return error.status === 413 && error.code === 'PAYLOAD_TOO_LARGE';
  });
});

test('contract primitives reject coercion, non-finite values, and wrong container shapes', () => {
  assert.deepEqual(expectRecord({ value: 1 }, 'root'), { value: 1 });
  assert.deepEqual(expectArray([1, 2], 'items'), [1, 2]);
  assert.equal(expectString('1', 'value'), '1');
  assert.equal(expectFiniteNumber(1.25, 'value'), 1.25);

  const cases: Array<() => unknown> = [
    () => expectRecord([], 'root'),
    () => expectRecord(null, 'root'),
    () => expectArray({}, 'items'),
    () => expectString(1, 'value'),
    () => expectFiniteNumber(Number.NaN, 'value'),
    () => expectFiniteNumber(Number.POSITIVE_INFINITY, 'value'),
  ];
  for (const parse of cases) assert.throws(parse, ContractParseError);
});

test('failure envelope parsing requires canonical string code and message fields', () => {
  assert.throws(() => parseApiFailure({ ok: true, error: {} }), ContractParseError);
  assert.throws(() => parseApiFailure({ ok: false, error: { code: 500, message: 'bad' } }), (error: unknown) => {
    assert.ok(error instanceof ContractParseError);
    return error.issues.includes('response.error.code: expected string');
  });
  assert.throws(() => parseApiFailure({ ok: false, error: { code: 'BAD', message: null } }), (error: unknown) => {
    assert.ok(error instanceof ContractParseError);
    return error.issues.includes('response.error.message: expected string');
  });
});
