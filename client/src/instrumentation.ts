import { logStructuredError } from '@/lib/server/observability';

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const state = globalThis as typeof globalThis & { __intactProcessObservers?: boolean };
  if (state.__intactProcessObservers) return;
  state.__intactProcessObservers = true;

  process.on('unhandledRejection', (error) => {
    logStructuredError('process.unhandled_rejection', error);
  });

  process.on('uncaughtExceptionMonitor', (error) => {
    logStructuredError('process.uncaught_exception', error);
  });
}
