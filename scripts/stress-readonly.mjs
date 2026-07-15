#!/usr/bin/env node

import process from 'node:process';

const args = new Map(
  process.argv.slice(2).map((argument) => {
    const [key, ...value] = argument.replace(/^--/, '').split('=');
    return [key, value.join('=') || 'true'];
  }),
);

const baseUrl = new URL(args.get('base') || process.env.INTACT_BASE_URL || 'https://ishsoutside.com');
const requestCount = positiveInteger(args.get('requests'), 120);
const concurrency = positiveInteger(args.get('concurrency'), 12);
const timeoutMs = positiveInteger(args.get('timeout-ms'), 8_000);
const cookie = process.env.INTACT_TEST_COOKIE?.trim();

let scenarios = [
  { name: 'health-db', path: '/api/health' },
  { name: 'login-page', path: '/login' },
  { name: 'socket-handshake', path: '/socket.io/?EIO=4&transport=polling' },
];

if (cookie) {
  scenarios.push(
    { name: 'boards', path: '/api/boards', authenticated: true },
    { name: 'ranking', path: '/api/igk/ranking?pageSize=10', authenticated: true },
    { name: 'notifications', path: '/api/notifications?pageSize=20', authenticated: true },
    { name: 'chat-rooms', path: '/api/chat/rooms', authenticated: true },
  );
}

const requestedScenarios = args.get('scenarios')
  ?.split(',')
  .map((name) => name.trim())
  .filter(Boolean);
if (requestedScenarios?.length) {
  const availableNames = new Set(scenarios.map((scenario) => scenario.name));
  const unknownNames = requestedScenarios.filter((name) => !availableNames.has(name));
  if (unknownNames.length) {
    throw new Error(`Unknown or unavailable scenarios: ${unknownNames.join(', ')}`);
  }
  const requestedNames = new Set(requestedScenarios);
  scenarios = scenarios.filter((scenario) => requestedNames.has(scenario.name));
}

function positiveInteger(raw, fallback) {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Expected a positive integer, received: ${raw}`);
  }
  return value;
}

function percentile(sorted, ratio) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

async function runScenario(scenario) {
  let cursor = 0;
  const durations = [];
  const statuses = new Map();
  const failures = [];
  const startedAt = performance.now();

  async function worker() {
    while (true) {
      const requestNumber = cursor;
      cursor += 1;
      if (requestNumber >= requestCount) return;

      const url = new URL(scenario.path, baseUrl);
      if (scenario.name === 'socket-handshake') {
        url.searchParams.set('t', `${Date.now()}-${requestNumber}`);
      }
      const requestStartedAt = performance.now();
      try {
        const response = await fetch(url, {
          cache: 'no-store',
          headers: scenario.authenticated && cookie ? { cookie } : undefined,
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        });
        await response.arrayBuffer();
        statuses.set(response.status, (statuses.get(response.status) || 0) + 1);
        if (response.status >= 500) {
          failures.push(`request ${requestNumber + 1}: HTTP ${response.status}`);
        }
      } catch (error) {
        failures.push(
          `request ${requestNumber + 1}: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        durations.push(performance.now() - requestStartedAt);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, requestCount) }, () => worker()));
  durations.sort((left, right) => left - right);
  const elapsedMs = performance.now() - startedAt;
  return {
    scenario: scenario.name,
    statuses: [...statuses.entries()]
      .sort(([left], [right]) => left - right)
      .map(([status, count]) => `${status}:${count}`)
      .join(', ') || '-',
    failures: failures.length,
    requestsPerSecond: Number(((requestCount / elapsedMs) * 1_000).toFixed(1)),
    p50Ms: Number(percentile(durations, 0.5).toFixed(1)),
    p95Ms: Number(percentile(durations, 0.95).toFixed(1)),
    p99Ms: Number(percentile(durations, 0.99).toFixed(1)),
    maxMs: Number((durations.at(-1) || 0).toFixed(1)),
    failureSamples: failures.slice(0, 3),
  };
}

console.log(
  `Read-only stress test: ${baseUrl.origin} (${requestCount} requests × ${concurrency} concurrency)`,
);
if (!cookie) {
  console.log('Authenticated scenarios skipped. Set INTACT_TEST_COOKIE without printing it to enable them.');
}

const results = [];
for (const scenario of scenarios) {
  const result = await runScenario(scenario);
  results.push(result);
  console.table([{
    scenario: result.scenario,
    statuses: result.statuses,
    failures: result.failures,
    rps: result.requestsPerSecond,
    p50_ms: result.p50Ms,
    p95_ms: result.p95Ms,
    p99_ms: result.p99Ms,
    max_ms: result.maxMs,
  }]);
  if (result.failureSamples.length > 0) console.error(result.failureSamples.join('\n'));
}

if (results.some((result) => result.failures > 0)) process.exitCode = 1;
