import type { ApiResult } from '@/types/api';
import {
  ContractParseError,
  expectArray,
  expectFiniteNumber,
  expectRecord,
  expectString,
  parseApiResult,
} from './runtime';

export const HOME_SECTIONS = ['boards', 'notices', 'leaders', 'notifications', 'balance'] as const;
export type HomeSection = (typeof HOME_SECTIONS)[number];

export interface HomeSectionError {
  code: string;
  message: string;
  retryable: boolean;
}

export type HomeEntity = Record<string, unknown>;

export interface HomeAccount {
  currentIgk: number;
  jojolRank: number | null;
  unreadCount: number;
}

export interface HomeData {
  boards: HomeEntity[];
  notices: HomeEntity[];
  leaders: HomeEntity[];
  account: HomeAccount;
  generatedAt: string;
  sectionErrors: Partial<Record<HomeSection, HomeSectionError>>;
}

function parseEntity(value: unknown, path: string, requiredFields: readonly string[]) {
  const entity = expectRecord(value, path);
  for (const field of requiredFields) expectString(entity[field], `${path}.${field}`);
  return entity;
}

function parseEntities(value: unknown, path: string, requiredFields: readonly string[]) {
  return expectArray(value, path).map((item, index) =>
    parseEntity(item, `${path}[${index}]`, requiredFields));
}

function parseAccount(value: unknown): HomeAccount {
  const account = expectRecord(value, 'home.account');
  const jojolRank = account.jojolRank;
  if (jojolRank !== null && (!Number.isInteger(jojolRank) || Number(jojolRank) < 1)) {
    throw new ContractParseError(['home.account.jojolRank: expected positive integer or null']);
  }
  const unreadCount = expectFiniteNumber(account.unreadCount, 'home.account.unreadCount');
  if (!Number.isInteger(unreadCount) || unreadCount < 0) {
    throw new ContractParseError(['home.account.unreadCount: expected non-negative integer']);
  }
  return {
    currentIgk: expectFiniteNumber(account.currentIgk, 'home.account.currentIgk'),
    jojolRank: jojolRank === null ? null : Number(jojolRank),
    unreadCount,
  };
}

function parseSectionErrors(value: unknown): HomeData['sectionErrors'] {
  if (value === undefined) return {};
  const errors = expectRecord(value, 'home.sectionErrors');
  const parsed: HomeData['sectionErrors'] = {};
  for (const section of HOME_SECTIONS) {
    if (errors[section] === undefined) continue;
    const error = expectRecord(errors[section], `home.sectionErrors.${section}`);
    if (typeof error.retryable !== 'boolean') {
      throw new ContractParseError([`home.sectionErrors.${section}.retryable: expected boolean`]);
    }
    parsed[section] = {
      code: expectString(error.code, `home.sectionErrors.${section}.code`),
      message: expectString(error.message, `home.sectionErrors.${section}.message`),
      retryable: error.retryable,
    };
  }
  return parsed;
}

export function parseHomeData(value: unknown): HomeData {
  const home = expectRecord(value, 'home');
  return {
    boards: parseEntities(home.boards, 'home.boards', ['id', 'slug', 'name']),
    notices: parseEntities(home.notices, 'home.notices', ['id', 'title']),
    leaders: parseEntities(home.leaders, 'home.leaders', ['id']),
    account: parseAccount(home.account),
    generatedAt: expectString(home.generatedAt, 'home.generatedAt'),
    sectionErrors: parseSectionErrors(home.sectionErrors),
  };
}

export function parseHomeApiResult(value: unknown): ApiResult<HomeData> {
  return parseApiResult(value, parseHomeData);
}
