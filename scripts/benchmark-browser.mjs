/**
 * 두 로컬 production 서버를 같은 지연·압축·캐시 조건으로 비교하는 프록시입니다.
 * BASELINE_PORT=3194 OPTIMIZED_PORT=3195 node scripts/benchmark-browser.mjs
 * /__bench/start?variant=baseline&path=/login&auth=0&run=1 에서 측정을 시작합니다.
 * 인증 화면은 같은 합성 DB와 비밀값을 사용하는 두 서버에서 로컬 계정으로 로그인합니다.
 * 자동화 시 BENCH_FIXTURE_FILE, BENCH_CHAT_FIXTURE_FILE에 합성 {token, cacheScope} JSON을
 * 전달할 수 있습니다. 파일은 저장소 밖에 두며 결과에는 쿠키·본문·사용자 ID를 기록하지 않습니다.
 */
import http from 'node:http';
import net from 'node:net';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const variants = { baseline: Number(process.env.BASELINE_PORT || 3194), optimized: Number(process.env.OPTIMIZED_PORT || 3195) };
const port = Number(process.env.BENCH_PORT || 3212);
const realtimePort = Number(process.env.BENCH_REALTIME_PORT || 3196);
const latencyMs = Number(process.env.BENCH_LATENCY_MS || 150);
const outputDir = path.resolve(process.env.BENCH_OUTPUT_DIR || '/tmp/intact-browser-benchmark');
const allowedPaths = new Set(['/login', '/', '/messages', '/boards/question', '/notifications', '/profile']);
if (![port, realtimePort, ...Object.values(variants)].every((value) => Number.isInteger(value) && value > 0 && value < 65536)
  || !Number.isFinite(latencyMs) || latencyMs < 0 || latencyMs > 5000) throw new Error('포트 또는 지연 설정이 올바르지 않습니다.');
mkdirSync(outputDir, { recursive: true, mode: 0o700 });

function browserProbe(meta) {
  // 측정마다 같은 문서 캐시 조건을 만들고, 목표 콘텐츠가 반영된 두 프레임 뒤를 기록합니다.
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith('intact:resource:') || key?.startsWith('intact:chat:')) sessionStorage.removeItem(key);
    }
  } catch { /* 선택적 브라우저 캐시 */ }
  let ready = null;
  let reporting = false;
  const target = () => {
    if (meta.path === '/login') return document.querySelector('input[placeholder="비밀번호 입력"]');
    if (meta.path === '/messages') {
      const viewport = document.querySelector('[data-testid="messages-viewport"]');
      return viewport?.querySelector('button') && !viewport.querySelector('[aria-busy="true"]') ? viewport : null;
    }
    if (meta.path === '/notifications') return document.querySelector('main article h3');
    if (meta.path === '/profile') return document.querySelector('main h2');
    return document.querySelector('main a[href^="/post/"]');
  };
  const report = async (timedOut = false) => {
    if (reporting) return;
    reporting = true;
    observer.disconnect();
    clearTimeout(deadline);
    const navigation = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource').map((entry) => ({
      // 개인 리소스의 경로와 검색어를 결과에 남기지 않습니다.
      kind: new URL(entry.name).pathname.startsWith('/_next/') ? 'asset'
        : new URL(entry.name).pathname.startsWith('/api/') ? 'api' : 'other',
      durationMs: +entry.duration.toFixed(2), encodedBytes: entry.encodedBodySize,
    }));
    const result = { ...meta, contentReadyMs: ready, ttfbMs: navigation?.responseStart, timedOut, resources };
    await fetch('/__bench/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(result) });
    // React가 아직 hydration 중이어도 DOM을 바꾸지 않습니다.
    console.info('Intact benchmark result', JSON.stringify({ variant: meta.variant, path: meta.path, run: meta.run, contentReadyMs: ready, timedOut }));
  };
  const check = () => {
    if (ready !== null || !target()?.getBoundingClientRect().width) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (ready !== null) return;
      ready = +performance.now().toFixed(2);
      observer.disconnect();
      setTimeout(() => { void report(); }, 750);
    }));
  };
  const observer = new MutationObserver(check);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', check);
  const deadline = setTimeout(() => { void report(true); }, 20000);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://benchmark.local');
  if (url.pathname === '/__bench/result' && request.method === 'POST') {
    let body = '';
    request.on('data', (chunk) => { body += chunk; if (body.length > 100000) request.destroy(); });
    request.on('end', () => {
      try {
        const result = JSON.parse(body);
        if (!Object.hasOwn(variants, result.variant) || !allowedPaths.has(result.path)) throw new Error('invalid result');
        appendFileSync(path.join(outputDir, 'browser-results.jsonl'), `${JSON.stringify(result)}\n`, { mode: 0o600 });
        console.log(`${result.variant} ${result.path} ${result.run}: ${result.contentReadyMs}ms${result.timedOut ? ' (timeout)' : ''}`);
        response.writeHead(204).end();
      } catch { response.writeHead(400).end(); }
    });
    return;
  }
  if (url.pathname === '/__bench/start') {
    const variant = url.searchParams.get('variant');
    const route = url.searchParams.get('path') || '/';
    if (!Object.hasOwn(variants, variant) || !allowedPaths.has(route)) { response.writeHead(400).end(); return; }
    const cookies = [`intact_bench_variant=${variant}; Path=/; SameSite=Lax`];
    const fixtureFile = route === '/messages' ? process.env.BENCH_CHAT_FIXTURE_FILE : process.env.BENCH_FIXTURE_FILE;
    if (url.searchParams.get('auth') === '0') {
      cookies.push('igwak_session=; Path=/; Max-Age=0', 'intact_cache_scope=; Path=/; Max-Age=0');
    } else if (fixtureFile) {
      const fixture = JSON.parse(readFileSync(fixtureFile, 'utf8'));
      if (![fixture.token, fixture.cacheScope].every((value) => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value))) {
        response.writeHead(400).end('합성 세션 파일을 확인해 주세요.'); return;
      }
      cookies.push(`igwak_session=${fixture.token}; Path=/; HttpOnly; SameSite=Lax`, `intact_cache_scope=${fixture.cacheScope}; Path=/; SameSite=Lax`);
    }
    const run = encodeURIComponent(url.searchParams.get('run') || '1');
    response.writeHead(302, { 'Cache-Control': 'no-store', 'Set-Cookie': cookies, Location: `${route}?__bench_run=${run}` }).end();
    return;
  }
  const variantCookie = /(?:^|;\s*)intact_bench_variant=(baseline|optimized)(?:;|$)/.exec(request.headers.cookie || '')?.[1];
  const variant = variantCookie || 'baseline';
  const upstreamPort = url.pathname.startsWith('/socket.io/') ? realtimePort : variants[variant];
  const headers = { ...request.headers, host: `127.0.0.1:${upstreamPort}`, 'accept-encoding': 'identity',
    'x-forwarded-host': request.headers.host, 'x-forwarded-proto': 'http' };
  delete headers['if-none-match'];
  delete headers['if-modified-since'];
  const upstream = http.request({ hostname: '127.0.0.1', port: upstreamPort, path: request.url, method: request.method, headers }, (incoming) => {
    const chunks = [];
    incoming.on('data', (chunk) => chunks.push(chunk));
    incoming.on('end', () => {
      let body = Buffer.concat(chunks);
      const type = incoming.headers['content-type'] || '';
      const outgoing = { ...incoming.headers, 'cache-control': 'no-store' };
      delete outgoing['content-length'];
      delete outgoing['transfer-encoding'];
      delete outgoing.etag;
      if (type.includes('text/html') && allowedPaths.has(url.pathname) && url.searchParams.has('__bench_run')) {
        const meta = { variant, path: url.pathname, run: url.searchParams.get('__bench_run'), latencyMs };
        const encodedMeta = JSON.stringify(meta).replace(/</g, '\\u003c');
        body = Buffer.from(body.toString().replace('<head>', `<head><script>(${browserProbe})(${encodedMeta});</script>`));
      }
      if (/javascript|text\/css|text\/html|application\/json|text\/x-component/.test(type)) {
        body = gzipSync(body); outgoing['content-encoding'] = 'gzip';
      }
      outgoing['content-length'] = body.length;
      setTimeout(() => { response.writeHead(incoming.statusCode, outgoing).end(body); }, latencyMs);
    });
  });
  upstream.on('error', () => { response.writeHead(502, { 'Cache-Control': 'no-store' }).end('로컬 비교 서버가 응답하지 않습니다.'); });
  request.pipe(upstream);
});

server.on('upgrade', (request, socket, head) => {
  if (!request.url.startsWith('/socket.io/')) { socket.destroy(); return; }
  const upstream = net.connect(realtimePort, '127.0.0.1', () => {
    let raw = `${request.method} ${request.url} HTTP/${request.httpVersion}\r\n`;
    for (let index = 0; index < request.rawHeaders.length; index += 2) raw += `${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}\r\n`;
    upstream.write(`${raw}\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});
server.listen(port, process.env.BENCH_BIND || '127.0.0.1', () => {
  console.log(`비교 프록시: http://localhost:${port}, 응답 지연 ${latencyMs}ms, 결과 ${outputDir}`);
});
