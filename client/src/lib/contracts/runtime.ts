import type { ApiFailure, ApiResult } from '@/types/api';

export type ContractParser<T> = (value: unknown) => T;

export class ContractParseError extends Error {
  constructor(
    public readonly issues: readonly string[],
    message = 'API 응답 형식이 올바르지 않습니다.',
  ) {
    super(message);
    this.name = 'ContractParseError';
  }
}

export function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ContractParseError([`${path}: expected object`]);
  }
  return value as Record<string, unknown>;
}

export function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new ContractParseError([`${path}: expected array`]);
  return value;
}

export function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new ContractParseError([`${path}: expected string`]);
  return value;
}

export function expectFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ContractParseError([`${path}: expected finite number`]);
  }
  return value;
}

export function parseApiFailure(value: unknown): ApiFailure {
  const result = expectRecord(value, 'response');
  if (result.ok !== false) throw new ContractParseError(['response.ok: expected false']);
  const error = expectRecord(result.error, 'response.error');
  return {
    ok: false,
    error: {
      code: expectString(error.code, 'response.error.code'),
      message: expectString(error.message, 'response.error.message'),
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };
}

export function parseApiResult<T>(value: unknown, parseData: ContractParser<T>): ApiResult<T> {
  const result = expectRecord(value, 'response');
  if (result.ok === false) return parseApiFailure(result);
  if (result.ok !== true) throw new ContractParseError(['response.ok: expected boolean discriminator']);
  return { ok: true, data: parseData(result.data) };
}
