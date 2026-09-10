import { riroBridgeBaseUrl } from './riro';

export type RiroBridgeState = 'ok' | 'degraded' | 'unreachable' | 'disabled' | 'misconfigured';

export type RiroBridgeStatus = {
  state: RiroBridgeState;
  degraded: boolean;
  contractVersion: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureCategory: string | null;
  lastFailureReason: string | null;
  failureStreak: number | null;
  captureEnabled: boolean | null;
  checkedAt: string;
};

const CACHE_MS = 60_000;
const PROBE_TIMEOUT_MS = 3_000;
let cached: { value: RiroBridgeStatus; expiresAt: number } | null = null;

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export function summarizeRiroBridgeHealth(payload: unknown, checkedAt: string): RiroBridgeStatus {
  const root = record(payload);
  const verification = record(root.verification);
  const diagnostics = record(root.diagnostics);
  const degraded = root.status === 'unhealthy' || verification.degraded === true;
  return {
    state: degraded ? 'degraded' : 'ok',
    degraded,
    contractVersion: text(root.contractVersion),
    lastSuccessAt: text(verification.lastSuccessAt),
    lastFailureAt: text(verification.lastFailureAt),
    lastFailureCategory: text(verification.lastFailureCategory),
    lastFailureReason: text(verification.lastFailureReason),
    failureStreak:
      typeof verification.failureStreak === 'number' ? verification.failureStreak : null,
    captureEnabled: diagnostics.captureEnabled === true,
    checkedAt,
  };
}

function emptyStatus(state: RiroBridgeState, checkedAt: string): RiroBridgeStatus {
  return {
    state,
    degraded: false,
    contractVersion: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureCategory: null,
    lastFailureReason: null,
    failureStreak: null,
    captureEnabled: null,
    checkedAt,
  };
}

async function probeRiroBridge(): Promise<RiroBridgeStatus> {
  const checkedAt = new Date().toISOString();
  if (process.env.RIRO_AUTH_MODE !== 'BRIDGE') return emptyStatus('disabled', checkedAt);
  let base: URL;
  try {
    base = riroBridgeBaseUrl();
  } catch {
    return emptyStatus('misconfigured', checkedAt);
  }
  try {
    const response = await fetch(new URL('/health', base), {
      cache: 'no-store',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => null);
    if (typeof payload !== 'object' || payload === null) {
      return emptyStatus(response.ok ? 'misconfigured' : 'unreachable', checkedAt);
    }
    return summarizeRiroBridgeHealth(payload, checkedAt);
  } catch {
    return emptyStatus('unreachable', checkedAt);
  }
}

export async function getRiroBridgeStatus(): Promise<RiroBridgeStatus> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;
  const value = await probeRiroBridge();
  cached = { value, expiresAt: now + CACHE_MS };
  return value;
}
