import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function bootstrapModule(resolveSession: (request: Request) => Promise<unknown>, getPlatformMode: () => Promise<unknown>) {
  const source = readFileSync(path.resolve(__dirname, '../src/lib/server/portal-bootstrap.ts'), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(output, {
    exports,
    setTimeout,
    clearTimeout,
    require: (name: string) => {
      if (name === './session') return { resolveSession, publicUser: (user: unknown) => user };
      if (name === './platform-mode') return { getPlatformMode, platformModeVersion: () => '0:1' };
      throw new Error(`Unexpected module: ${name}`);
    },
  });
  return exports.loadPortalBootstrap as (request: Request) => Promise<{
    session: { authenticated: boolean; user?: { id: string }; reason?: string } | null;
    platformMode: { bSideEnabled: boolean; version: string } | null;
  }>;
}

test('서버 초기 상태는 동시 요청의 세션을 섞거나 다음 요청에 재사용하지 않는다', async () => {
  const pending = new Map<string, (value: unknown) => void>();
  const load = bootstrapModule((request) => new Promise((resolve) => {
    pending.set(request.headers.get('cookie') ?? '', resolve);
  }), async () => ({ bSideEnabled: false, maintenanceEnabled: false }));
  const first = load(new Request('https://intact.test', { headers: { cookie: 'first' } }));
  const second = load(new Request('https://intact.test', { headers: { cookie: 'second' } }));
  const session = (id: string) => ({ user: { id, status: 'ACTIVE', currentIgk: 10, lifetimeIgk: 20 }, expiresAt: new Date('2099-01-01') });
  pending.get('second')!(session('second'));
  assert.equal((await second).session?.user?.id, 'second');
  pending.get('first')!(session('first'));
  assert.equal((await first).session?.user?.id, 'first');
  const expired = load(new Request('https://intact.test', { headers: { cookie: 'first' } }));
  pending.get('first')!(null);
  assert.equal((await expired).session?.authenticated, false);
});

test('초기 세션과 모드 조회 실패는 서로 독립적으로 브라우저 재확인에 넘긴다', async () => {
  const noSession = bootstrapModule(async () => { throw new Error('database unavailable'); }, async () => ({ bSideEnabled: true, maintenanceEnabled: false }));
  const first = await noSession(new Request('https://intact.test'));
  assert.equal(first.session, null);
  assert.equal(first.platformMode?.bSideEnabled, true);
  const noMode = bootstrapModule(async () => null, async () => { throw new Error('mode unavailable'); });
  const second = await noMode(new Request('https://intact.test'));
  assert.equal(second.session?.authenticated, false);
  assert.equal(second.platformMode, null);
});

test('이용 제한 계정의 초기 상태는 신원 정보를 포함하지 않는다', async () => {
  const load = bootstrapModule(async () => ({ user: { id: 'private-user', status: 'PENDING_REVERIFICATION' } }), async () => ({ bSideEnabled: false, maintenanceEnabled: false }));
  const result = await load(new Request('https://intact.test'));
  assert.equal(result.session?.authenticated, false);
  assert.equal(result.session?.reason, 'PENDING_REVERIFICATION');
  assert.equal(result.session?.user, undefined);
});

test('응답하지 않는 초기 조회가 전체 문서 전송을 막지 않는다', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const load = bootstrapModule(() => new Promise(() => {}), async () => ({ bSideEnabled: true, maintenanceEnabled: false }));
  const pending = load(new Request('https://intact.test'));
  await new Promise(setImmediate);
  context.mock.timers.tick(1_000);
  const result = await pending;
  assert.equal(result.session, null);
  assert.equal(result.platformMode?.bSideEnabled, true);
});
