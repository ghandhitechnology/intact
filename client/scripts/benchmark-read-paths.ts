/**
 * 읽기 경로의 SQL 수, 실제 조회 행 수와 응답 시간을 두 체크아웃에서 비교합니다.
 * client에서 실행:
 * TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/intact_bench \
 * BASELINE_REPO=/absolute/path/to/baseline yarn tsx scripts/benchmark-read-paths.ts
 * 두 체크아웃의 의존성과 Prisma Client, 테스트 DB의 마이그레이션이 준비되어야 합니다.
 * 합성 데이터는 트랜잭션 종료 시 롤백합니다. 측정은 단일 DB 연결에서 수행하며
 * 실제 서비스의 연결 풀·네트워크 지연은 포함하지 않습니다. 응답 생성 시각만 비교에서 제외합니다.
 * 홈은 테스트 DB에 이미 있는 게시판도 포함하므로 기존 데이터도 조회 행 수에 반영됩니다.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { PrismaClient, type Prisma } from '@prisma/client';

const scriptPath = path.resolve(process.argv[1]!);
const featureRepo = path.resolve(path.dirname(scriptPath), '../..');
const SAMPLES = 15;
const BOARD_COUNT = 3;
const POSTS_PER_BOARD = 500;
const ROOM_COUNT = 20;
const MESSAGES_PER_ROOM = 500;

type Fixture = { seed: string; now: string };
type Query = { query: string; params: string };
type Measurement = { medianMs: number; p95Ms: number; sqlCount: number; selectedRows: number; payload: unknown };
type Results = { home: Measurement; chat: Measurement };

function testDatabaseUrl() {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) throw new Error('TEST_DATABASE_URL이 필요합니다.');
  const url = new URL(raw);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !/(?:^|[_-])(?:test|bench|benchmark)(?:[_-]|$)/i.test(name)
    || url.searchParams.has('host')) {
    throw new Error('루프백 주소의 test/bench 전용 PostgreSQL DB만 사용할 수 있습니다.');
  }
  return raw;
}

function fixtureId(seed: string, label: string) {
  const hex = createHash('sha256').update(`${seed}:${label}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4000-8000-${hex.slice(20, 32)}`;
}

async function seedFixture(tx: Prisma.TransactionClient, fixture: Fixture) {
  const id = (label: string) => fixtureId(fixture.seed, label);
  const now = new Date(fixture.now);
  const viewerId = id('viewer');
  const peerId = id('peer');
  await tx.user.createMany({ data: [viewerId, peerId].map((userId) => ({
    id: userId, createdAt: now, updatedAt: now, loginId: `bench-${userId.slice(0, 20)}`,
    nickname: `측정-${userId.slice(0, 20)}`, passwordHash: 'unused-synthetic-password',
    role: 'TEACHER' as const, currentIgk: 500, lifetimeIgk: 500, level: 4,
  })) });
  const token = createHash('sha256').update(`${fixture.seed}:session`).digest('base64url');
  await tx.session.create({ data: {
    id: id('session'), userId: viewerId, tokenHash: createHash('sha256').update(token).digest('hex'),
    createdAt: now, lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000),
  } });
  const boards = Array.from({ length: BOARD_COUNT }, (_, index) => id(`board-${index}`));
  await tx.board.createMany({ data: boards.map((boardId, index) => ({
    id: boardId, createdAt: now, updatedAt: now, slug: `bench-${boardId}`, name: `측정 게시판 ${index}`,
    description: '롤백되는 합성 게시판', sortOrder: 9000 + index,
  })) });
  const content = '서버 조회 성능을 측정하는 합성 본문입니다. '.repeat(30);
  await tx.post.createMany({ data: boards.flatMap((boardId, boardIndex) => Array.from({ length: POSTS_PER_BOARD }, (_, index) => ({
    id: id(`post-${boardIndex}-${index}`), boardId, authorId: peerId, kind: 'STANDARD' as const,
    createdAt: now, updatedAt: now, publishedAt: new Date(now.getTime() - index * 60_000),
    title: `측정 게시글 ${boardIndex}-${index}`, content, contentText: content, isPinned: index === 400,
  }))) });
  await tx.notice.createMany({ data: Array.from({ length: 2 }, (_, index) => ({
    id: id(`notice-${index}`), authorId: peerId, createdAt: now, updatedAt: now,
    publishedAt: new Date(now.getTime() - index * 1_000), title: `측정 공지 ${index}`, content,
    status: 'PUBLISHED' as const,
  })) });
  await tx.notification.createMany({ data: Array.from({ length: 20 }, (_, index) => ({
    id: id(`notification-${index}`), userId: viewerId, createdAt: now, type: 'SYSTEM' as const, title: '합성 알림',
  })) });
  const rooms = Array.from({ length: ROOM_COUNT }, (_, index) => id(`room-${index}`));
  await tx.chatRoom.createMany({ data: rooms.map((roomId, index) => ({
    id: roomId, title: `측정 대화방 ${index}`, createdAt: now, updatedAt: now,
    lastMessageAt: new Date(now.getTime() - index * 1_000),
  })) });
  await tx.chatMember.createMany({ data: rooms.flatMap((roomId) => [viewerId, peerId].map((userId) => ({
    roomId, userId, joinedAt: new Date(now.getTime() - 86_400_000), lastReadSequence: BigInt(250),
  }))) });
  for (const [roomIndex, roomId] of rooms.entries()) {
    await tx.message.createMany({ data: Array.from({ length: MESSAGES_PER_ROOM }, (_, index) => ({
      id: id(`message-${roomIndex}-${index}`), roomId, senderId: peerId, sequence: BigInt(index + 1),
      createdAt: new Date(now.getTime() - (MESSAGES_PER_ROOM - index) * 1_000), content,
    })) });
  }
  return { viewerId, token };
}

// EXPLAIN의 입력은 Prisma가 만든 SELECT와 그 바인딩 값뿐입니다.
function bindSelect(query: Query) {
  const values: unknown[] = JSON.parse(query.params);
  assert.match(query.query.trim(), /^SELECT\b/i);
  return query.query.replace(/\$(\d+)\b/g, (_, index: string) => {
    const value = values[Number(index) - 1];
    if (typeof value === 'string') return `E'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (value === null) return 'NULL';
    throw new Error('지원하지 않는 SQL 바인딩 값입니다.');
  });
}

async function worker(databaseUrl: string, repo: string, fixture: Fixture): Promise<Results> {
  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: databaseUrl, OUTBOX_ENABLED: 'true' });
  for (const key of ['REDIS_URL', 'ADMIN_INITIAL_PASSWORD', 'NOTICE_REQUEST_SCHEDULER_FALLBACK']) delete process.env[key];
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [{ emit: 'event', level: 'query' }] });
  const queries: Query[] = [];
  client.$on('query', (event) => queries.push(event));
  const rollback = new Error('합성 측정 데이터 롤백');
  let results: Results | undefined;
  try {
    await assert.rejects(client.$transaction(async (tx) => {
      const { viewerId, token } = await seedFixture(tx, fixture);
      // 기존 경로의 중첩 $transaction도 같은 연결에 포함하여 모든 쓰기를 롤백합니다.
      global.prisma = new Proxy(tx, { get(target, key) {
        if (key === '$transaction') return (items: Promise<unknown>[]) => Promise.all(items);
        if (key === 'board') return new Proxy(target.board, { get(board, method) {
          if (method !== 'createMany') return Reflect.get(board, method);
          return (args: Prisma.BoardCreateManyArgs) => board.createMany({ ...args,
            // 빈 DB에 자동 생성되는 기본 게시판의 ID와 시각도 두 작업에서 일치시킵니다.
            data: [args.data].flat().map((row) => ({
              createdAt: new Date(fixture.now), updatedAt: new Date(fixture.now), ...row,
              id: row.id ?? fixtureId(fixture.seed, `default-board-${row.slug}`),
            })),
          });
        } });
        return Reflect.get(target, key);
      } }) as unknown as PrismaClient;
      const moduleAt = (relative: string) => import(pathToFileURL(path.join(repo, 'client/src', relative)).href);
      const [homeRoute, chatRoute, platform] = await Promise.all([
        moduleAt('app/api/home/route.ts'), moduleAt('app/api/chat/rooms/route.ts'), moduleAt('lib/server/platform-mode.ts'),
      ]);
      const measured: Partial<Results> = {};
      for (const [name, route, pathname] of [
        ['home', homeRoute, '/api/home'], ['chat', chatRoute, '/api/chat/rooms'],
      ] as const) {
        const request = () => new Request(`http://benchmark.internal${pathname}`, { headers: { cookie: `igwak_session=${token}` } });
        const primeMode = () => platform.primePlatformMode({ bSideEnabled: false, maintenanceEnabled: false, bSideEpoch: 0, updatedAt: new Date(fixture.now) });
        primeMode();
        for (let index = 0; index < 3; index += 1) await route.GET(request());
        const times: number[] = [];
        const sqlCounts: number[] = [];
        let payload: Record<string, unknown> = {};
        for (let index = 0; index < SAMPLES; index += 1) {
          primeMode();
          queries.length = 0;
          const start = performance.now();
          const response: Response = await route.GET(request());
          const envelope = await response.json();
          times.push(performance.now() - start);
          sqlCounts.push(queries.length);
          assert.equal(response.status, 200, JSON.stringify(envelope));
          payload = envelope.data;
          if (name === 'home') assert.deepEqual(payload.sectionErrors, {});
        }
        const rowQuery = queries.find((query) => name === 'home'
          ? /^SELECT "[^"]+"\."Post"\."id"/.test(query.query.trim())
          : /^SELECT "[^"]+"\."Message"\."id"/.test(query.query.trim()) || query.query.includes('CROSS JOIN LATERAL'));
        assert.ok(rowQuery, `${name}의 본문 조회 SQL을 찾지 못했습니다.`);
        const plan = await tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': Array<{ Plan: { 'Actual Rows': number } }> }>>(
          `EXPLAIN (ANALYZE, FORMAT JSON) ${bindSelect(rowQuery)}`,
        );
        assert.equal(new Set(sqlCounts).size, 1, '측정 중 SQL 수가 달라졌습니다.');
        delete payload.generatedAt;
        times.sort((a, b) => a - b);
        measured[name] = { medianMs: times[Math.floor(SAMPLES / 2)]!, p95Ms: times[Math.ceil(SAMPLES * 0.95) - 1]!,
          sqlCount: sqlCounts[0]!, selectedRows: plan[0]!['QUERY PLAN'][0]!.Plan['Actual Rows'], payload };
      }
      results = measured as Results;
      assert.ok(await tx.user.findUnique({ where: { id: viewerId } }));
      throw rollback;
    }, { timeout: 120_000 }), (error: unknown) => error === rollback);
    assert.equal(await client.user.findUnique({ where: { id: fixtureId(fixture.seed, 'viewer') } }), null);
    assert.ok(results);
    return results;
  } finally {
    delete global.prisma;
    await client.$disconnect();
  }
}

async function main() {
  const databaseUrl = testDatabaseUrl();
  if (process.argv[2] === '--worker') {
    const result = await worker(databaseUrl, process.cwd().replace(/[/\\]client$/, ''), JSON.parse(process.env.INTACT_BENCH_FIXTURE!));
    process.stdout.write(JSON.stringify(result));
    return;
  }
  const baselineRepo = process.env.BASELINE_REPO && path.resolve(process.env.BASELINE_REPO);
  if (!baselineRepo || !existsSync(path.join(baselineRepo, 'client/src/app/api/home/route.ts'))) {
    throw new Error('BASELINE_REPO에 비교할 체크아웃 경로를 지정해 주세요.');
  }
  const fixture: Fixture = { seed: randomUUID(), now: new Date(Date.now() - 60_000).toISOString() };
  const outputs = [baselineRepo, featureRepo].map((repo) => {
    const result = spawnSync(process.execPath, ['--import', path.join(featureRepo, 'client/node_modules/tsx/dist/loader.mjs'), scriptPath, '--worker'], {
      cwd: path.join(repo, 'client'), encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, TEST_DATABASE_URL: databaseUrl, TSX_TSCONFIG_PATH: path.join(repo, 'client/tsconfig.json'), INTACT_BENCH_FIXTURE: JSON.stringify(fixture) },
    });
    if (result.status !== 0) throw new Error(result.stderr || '측정 프로세스가 실패했습니다.');
    return JSON.parse(result.stdout) as Results;
  });
  const [before, after] = outputs as [Results, Results];
  for (const name of ['home', 'chat'] as const) assert.deepEqual(after[name].payload, before[name].payload, `${name} 응답이 변경되었습니다.`);
  const metrics = (result: Results) => Object.fromEntries(Object.entries(result).map(([name, { payload: _payload, ...values }]) => [name, values]));
  console.log(JSON.stringify({ fixture: { boards: BOARD_COUNT, posts: BOARD_COUNT * POSTS_PER_BOARD, rooms: ROOM_COUNT, messages: ROOM_COUNT * MESSAGES_PER_ROOM },
    samples: SAMPLES, identicalPayloads: true, rolledBack: true, baseline: metrics(before), current: metrics(after) }, null, 2));
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
