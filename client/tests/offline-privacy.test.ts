import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(__dirname, '..');

test('서비스 워커는 인증 정보 없이 오프라인 화면을 저장하고 이전 캐시를 지운다', async () => {
  type Handler = (event: { waitUntil: (value: Promise<unknown>) => void }) => void;
  const handlers = new Map<string, Handler>();
  const storedRequests: Request[] = [];
  const deletedCaches: string[] = [];
  let pending: Promise<unknown> = Promise.resolve();
  vm.runInNewContext(readFileSync(path.join(root, 'public/sw.js'), 'utf8'), {
    Request: class extends Request {
      constructor(input: string, init?: RequestInit) {
        super(new URL(input, 'https://intact.test'), init);
      }
    },
    self: {
      addEventListener: (name: string, handler: Handler) => handlers.set(name, handler),
      skipWaiting: () => undefined,
      registration: {},
      clients: { claim: async () => undefined },
    },
    caches: {
      open: async (name: string) => {
        assert.equal(name, 'intact-static-v3');
        return { addAll: async (requests: Request[]) => { storedRequests.push(...requests); } };
      },
      keys: async () => ['intact-static-v2', 'intact-static-v3'],
      delete: async (name: string) => { deletedCaches.push(name); return true; },
    },
  });
  const event = { waitUntil: (value: Promise<unknown>) => { pending = value; } };
  handlers.get('install')!(event);
  await pending;
  assert.equal(storedRequests.length, 1);
  assert.equal(storedRequests[0].url, 'https://intact.test/offline');
  assert.equal(storedRequests[0].credentials, 'omit');
  handlers.get('activate')!(event);
  await pending;
  assert.deepEqual(deletedCaches, ['intact-static-v2']);
});

type RenderNode = { type: string; props: { children?: RenderNode | string } };

function loadSourceModule(file: string, globals: Record<string, unknown>, requireModule: (name: string) => unknown) {
  const output = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(output, { exports, require: requireModule, ...globals });
  return exports;
}

test('오프라인 문서는 쿠키가 있어도 세션 조회와 클라이언트 데이터 공급자를 생략한다', async () => {
  let bootstrapCalls = 0;
  let headerReads = 0;
  const exports = loadSourceModule('src/app/layout.tsx', { process: { env: {} }, Request, URL }, (name) => {
    if (name === 'next/headers') return {
      headers: async () => {
        headerReads += 1;
        return new Headers({ 'x-intact-pathname': '/offline', cookie: 'igwak_session=synthetic' });
      },
    };
    if (name === '@/lib/server/portal-bootstrap') return {
      loadPortalBootstrap: async () => { bootstrapCalls += 1; throw new Error('세션을 조회하면 안 됩니다.'); },
    };
    if (name === 'react/jsx-runtime') return { jsx: (type: string, props: RenderNode['props']) => ({ type, props }) };
    return {};
  });
  const layout = exports.default as (props: { children: string }) => Promise<RenderNode>;
  const html = await layout({ children: '오프라인 안내' });
  assert.equal(headerReads, 1);
  assert.equal(bootstrapCalls, 0);
  assert.equal(html.type, 'html');
  const body = html.props.children as RenderNode;
  assert.equal(body.type, 'body');
  const main = body.props.children as RenderNode;
  assert.equal(main.type, 'main');
  assert.equal(main.props.children, '오프라인 안내');
});

test('미들웨어는 전달받은 경로 헤더를 덮어쓰며 오프라인 요청에서 API를 호출하지 않는다', async () => {
  let forwardedHeaders = new Headers();
  const exports = loadSourceModule('src/middleware.ts', {
    process: { env: {} }, Headers,
    fetch: () => { throw new Error('오프라인 문서에서 API를 호출하면 안 됩니다.'); },
  }, (name) => {
    if (name === '@/lib/request-id') return { requestId: () => 'test-request' };
    if (name === 'next/server') return { NextResponse: {
      next: (options: { request: { headers: Headers } }) => {
        forwardedHeaders = options.request.headers;
        return { headers: new Headers() };
      },
    } };
    return {};
  });
  const middleware = exports.middleware as (request: unknown) => Promise<unknown>;
  await middleware({ nextUrl: { pathname: '/offline', search: '' }, headers: new Headers({ 'x-intact-pathname': '/profile' }) });
  assert.equal(forwardedHeaders.get('x-intact-pathname'), '/offline');
  await middleware({ nextUrl: { pathname: '/api/platform', search: '' }, headers: new Headers({ 'x-intact-pathname': '/offline' }) });
  assert.equal(forwardedHeaders.get('x-intact-pathname'), '/api/platform');
});

test('캐시 삭제는 저장소 접근이 차단되어도 예외를 전파하지 않는다', () => {
  const storage = { get length(): number { throw new Error('SecurityError'); } };
  const exports = loadSourceModule('src/components/portal/ClientDataProvider.tsx', {
    window: {}, sessionStorage: storage,
  }, () => ({}));
  assert.doesNotThrow(() => (exports.clearClientDataCache as () => void)());
});
