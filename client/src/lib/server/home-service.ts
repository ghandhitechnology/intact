import type { HomeData, HomeSection, HomeSectionError } from '@/lib/contracts/home';
import { ContractParseError, expectArray, expectFiniteNumber, expectRecord } from '@/lib/contracts/runtime';

type HomeSourceLoader = (request: Request) => Promise<unknown>;

export interface HomeLoaders {
  boards: HomeSourceLoader;
  notices: HomeSourceLoader;
  leaders: HomeSourceLoader;
  notifications: HomeSourceLoader;
  balance: HomeSourceLoader;
}

export interface HomeServiceOptions {
  request: Request;
  currentIgk: number;
  loaders?: HomeLoaders;
  timeoutMs?: number;
  now?: () => Date;
}

class HomeSourceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'HomeSourceError';
  }
}

type RouteModule = { GET(request: Request): Promise<Response> };

async function invokeRoute(
  request: Request,
  path: string,
  loadModule: () => Promise<RouteModule>,
) {
  const sourceRequest = new Request(new URL(path, request.url), {
    method: 'GET',
    headers: request.headers,
    signal: request.signal,
  });
  const response = await (await loadModule()).GET(sourceRequest);
  const body: unknown = await response.json().catch(() => null);
  const envelope = expectRecord(body, 'source response');
  if (!response.ok || envelope.ok === false) {
    const error = typeof envelope.error === 'object' && envelope.error !== null
      ? envelope.error as Record<string, unknown>
      : {};
    const code = typeof error.code === 'string' ? error.code : `HTTP_${response.status}`;
    const message = typeof error.message === 'string'
      ? error.message
      : '홈 화면의 일부 정보를 불러오지 못했습니다.';
    throw new HomeSourceError(code, message, response.status >= 500 || response.status === 429);
  }
  return envelope.ok === true ? envelope.data : body;
}

export const defaultHomeLoaders: HomeLoaders = {
  boards: (request) => invokeRoute(request, '/api/boards', () => import('@/app/api/boards/route')),
  notices: (request) => invokeRoute(request, '/api/notices?limit=10', () => import('@/app/api/notices/route')),
  leaders: (request) => invokeRoute(request, '/api/igk/ranking', () => import('@/app/api/igk/ranking/route')),
  notifications: (request) => invokeRoute(request, '/api/notifications?pageSize=1', () => import('@/app/api/notifications/route')),
  balance: (request) => invokeRoute(request, '/api/igk/balance', () => import('@/app/api/igk/balance/route')),
};

function withTimeout<T>(task: Promise<T>, timeoutMs: number, signal: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new HomeSourceError('REQUEST_ABORTED', '요청이 취소되었습니다.', false));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      reject(new HomeSourceError('SECTION_TIMEOUT', '홈 화면의 일부 정보가 시간 내에 응답하지 않았습니다.', true));
    }, timeoutMs);
    const abort = () => {
      cleanup();
      reject(new HomeSourceError('REQUEST_ABORTED', '요청이 취소되었습니다.', false));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    signal.addEventListener('abort', abort, { once: true });
    task.then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); },
    );
  });
}

function sectionError(cause: unknown): HomeSectionError {
  if (cause instanceof HomeSourceError) {
    return { code: cause.code, message: cause.message, retryable: cause.retryable };
  }
  if (cause instanceof ContractParseError) {
    return {
      code: 'INVALID_SECTION_RESPONSE',
      message: '홈 화면의 일부 응답 형식이 올바르지 않습니다.',
      retryable: false,
    };
  }
  return {
    code: 'HOME_SECTION_FAILED',
    message: '홈 화면의 일부 정보를 불러오지 못했습니다.',
    retryable: true,
  };
}

type SectionResult<T> = { data: T; error?: never } | { data?: never; error: HomeSectionError };

async function loadSection<T>(
  section: HomeSection,
  loader: HomeSourceLoader,
  request: Request,
  timeoutMs: number,
  parse: (value: unknown) => T,
): Promise<[HomeSection, SectionResult<T>]> {
  try {
    const value = await withTimeout(loader(request), timeoutMs, request.signal);
    return [section, { data: parse(value) }];
  } catch (cause) {
    return [section, { error: sectionError(cause) }];
  }
}

function parseNamedArray(value: unknown, field: string) {
  const source = expectRecord(value, `home source ${field}`);
  return expectArray(source[field], `home source ${field}.${field}`).map((item, index) =>
    expectRecord(item, `home source ${field}.${field}[${index}]`));
}

function parseUnreadCount(value: unknown) {
  const source = expectRecord(value, 'home source notifications');
  const count = expectFiniteNumber(source.unreadCount, 'home source notifications.unreadCount');
  if (!Number.isInteger(count) || count < 0) {
    throw new ContractParseError(['home source notifications.unreadCount: expected non-negative integer']);
  }
  return count;
}

function parseBalance(value: unknown) {
  const source = expectRecord(value, 'home source balance');
  const igkRank = source.igkRank ?? null;
  if (igkRank !== null && (!Number.isInteger(igkRank) || Number(igkRank) < 1)) {
    throw new ContractParseError(['home source balance.igkRank: expected positive integer or null']);
  }
  return {
    currentIgk: expectFiniteNumber(source.currentIgk, 'home source balance.currentIgk'),
    igkRank: igkRank === null ? null : Number(igkRank),
  };
}

export async function loadHomeData({
  request,
  currentIgk,
  loaders = defaultHomeLoaders,
  timeoutMs = 10_000,
  now = () => new Date(),
}: HomeServiceOptions): Promise<HomeData> {
  const entries = await Promise.all([
    loadSection('boards', loaders.boards, request, timeoutMs, (value) => parseNamedArray(value, 'boards')),
    loadSection('notices', loaders.notices, request, timeoutMs, (value) => parseNamedArray(value, 'notices')),
    loadSection('leaders', loaders.leaders, request, timeoutMs, (value) => parseNamedArray(value, 'leaders')),
    loadSection('notifications', loaders.notifications, request, timeoutMs, parseUnreadCount),
    loadSection('balance', loaders.balance, request, timeoutMs, parseBalance),
  ]);

  const results = Object.fromEntries(entries) as Record<HomeSection, SectionResult<unknown>>;
  const errors: HomeData['sectionErrors'] = {};
  for (const [section, result] of entries) {
    if (result.error) errors[section] = result.error;
  }

  const boards = results.boards.data as HomeData['boards'] | undefined;
  const notices = results.notices.data as HomeData['notices'] | undefined;
  const leaders = results.leaders.data as HomeData['leaders'] | undefined;
  const unreadCount = results.notifications.data as number | undefined;
  const balance = results.balance.data as { currentIgk: number; igkRank: number | null } | undefined;

  return {
    boards: boards ?? [],
    notices: notices ?? [],
    leaders: leaders ?? [],
    account: {
      currentIgk: balance?.currentIgk ?? Number(currentIgk || 0),
      igkRank: balance?.igkRank ?? null,
      unreadCount: unreadCount ?? 0,
    },
    generatedAt: now().toISOString(),
    sectionErrors: errors,
  };
}
