import type { PlatformModeSnapshot } from '@/lib/contracts/portal-bootstrap';
import { getPlatformMode, platformModeVersion } from './platform-mode';
import { publicUser, resolveSession } from './session';

export function portalSessionSnapshot(session: Awaited<ReturnType<typeof resolveSession>>) {
  if (!session || session.user.status !== 'ACTIVE') {
    return {
      authenticated: false as const,
      reason: session?.user.status ?? null,
    };
  }
  return {
    authenticated: true as const,
    user: publicUser(session.user),
    currentIgk: session.user.currentIgk,
    lifetimeIgk: session.user.lifetimeIgk,
    mustChangePassword: session.user.mustChangePassword,
    expiresAt: session.expiresAt.toISOString(),
  };
}

function settleBootstrapTask<T>(task: Promise<T>): Promise<T | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 1_000);
    task.then(
      (value) => { clearTimeout(timeout); resolve(value); },
      () => { clearTimeout(timeout); resolve(null); },
    );
  });
}

export async function loadPortalBootstrap(request: Request) {
  // 요청 간 세션을 캐시하지 않습니다. 지연되거나 실패한 조회는 브라우저에서 다시 확인합니다.
  const [session, platformMode] = await Promise.all([
    settleBootstrapTask(resolveSession(request).then(portalSessionSnapshot)),
    settleBootstrapTask(getPlatformMode().then((mode): PlatformModeSnapshot => ({
      bSideEnabled: mode.bSideEnabled,
      maintenanceEnabled: mode.maintenanceEnabled,
      version: platformModeVersion(mode),
    }))),
  ]);
  return { session, platformMode };
}
