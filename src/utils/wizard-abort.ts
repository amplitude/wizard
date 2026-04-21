/**
 * Single exit point for the wizard. Use instead of process.exit() directly.
 *
 * Sequence: cleanup -> error capture (optional) -> analytics shutdown -> outro -> process.exit
 *
 * WizardError is a data carrier passed to wizardAbort() for analytics context, never thrown.
 * The legacy abort() in setup-utils.ts delegates here.
 */
import { analytics } from './analytics';
import { getUI } from '../ui';
import {
  flushSentry,
  captureError as sentryCaptureError,
} from '../lib/observability';

export class WizardError extends Error {
  constructor(
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'WizardError';
  }
}

interface WizardAbortOptions {
  message?: string;
  error?: Error | WizardError;
  exitCode?: number;
}

const cleanupFns: Array<() => void> = [];

export function registerCleanup(fn: () => void): void {
  cleanupFns.push(fn);
}

export function clearCleanup(): void {
  cleanupFns.length = 0;
}

export async function wizardAbort(
  options?: WizardAbortOptions,
): Promise<never> {
  const {
    message = 'Wizard setup cancelled.',
    error,
    exitCode = 1,
  } = options ?? {};

  // 1. Run registered cleanup functions
  for (const fn of cleanupFns) {
    try {
      fn();
    } catch {
      /* cleanup should not prevent exit */
    }
  }

  // 2. Capture error in analytics + Sentry (if provided)
  if (error) {
    analytics.captureException(error, {
      ...((error instanceof WizardError && error.context) || {}),
    });
    sentryCaptureError(error, {
      exitCode,
      ...((error instanceof WizardError && error.context) || {}),
    });
  }

  // 3. Shutdown analytics and flush Sentry
  const errorCtx =
    error instanceof WizardError && error.context ? error.context : {};
  await Promise.all([
    analytics.shutdown(error ? 'error' : 'cancelled', {
      outcome: error ? 'error' : 'cancelled',
      exitCode,
      failureCategory:
        typeof errorCtx['error category'] === 'string'
          ? errorCtx['error category']
          : undefined,
      failureSubcategory:
        typeof errorCtx['error type'] === 'string'
          ? errorCtx['error type']
          : undefined,
      activated: false,
    }),
    flushSentry().catch(() => {
      /* Sentry flush failure is non-fatal */
    }),
  ]);

  // 4. Display message to user
  getUI().cancel(message);

  // 5. Exit (fires 'exit' event so TUI cleanup runs)
  // In agent mode, always exit 0 — errors are communicated via NDJSON output,
  // not exit codes. A non-zero exit makes callers (like Claude Code) show
  // ugly red error banners when the error is already reported in the output.
  const isAgentMode =
    process.env.AMPLITUDE_WIZARD_AGENT === '1' ||
    process.argv.includes('--agent');
  return process.exit(isAgentMode ? 0 : exitCode);
}
