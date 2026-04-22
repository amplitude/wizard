import { AMPLITUDE_FLAG_HEADER_PREFIX, VERSION } from '../lib/constants';
import {
  getRunIdHex,
  getAttemptIdHex,
  getRunId,
  getAttemptId,
  getSessionId,
} from '../lib/observability';
import { getExecutionMode } from '../lib/mode-config';

/**
 * Builds a list of custom headers for ANTHROPIC_CUSTOM_HEADERS.
 */
export function createCustomHeaders(): {
  add(key: string, value: string): void;
  /** Add a header without auto-prefixing (e.g. W3C `traceparent`). */
  addRaw(key: string, value: string): void;
  /** Add a feature flag for Amplitude ($feature/<flagKey>: variant). */
  addFlag(flagKey: string, variant: string): void;
  encode(): string;
} {
  const entries: Array<{ key: string; value: string }> = [];

  return {
    add(key: string, value: string): void {
      const name =
        key.startsWith('x-') || key.startsWith('X-') ? key : `X-${key}`;
      entries.push({ key: name, value });
    },

    addRaw(key: string, value: string): void {
      entries.push({ key, value });
    },

    addFlag(flagKey: string, variant: string): void {
      const headerName = AMPLITUDE_FLAG_HEADER_PREFIX + flagKey.toUpperCase();
      entries.push({ key: headerName, value: variant });
    },

    encode(): string {
      return entries.map(({ key, value }) => `${key}: ${value}`).join('\n');
    },
  };
}

/**
 * Build the standard tracing header bag attached to every outbound wizard
 * request. Produces:
 *
 *   traceparent         — W3C trace-context (version-traceId-parentId-flags)
 *   X-Wizard-Run-Id     — short log-friendly run id (frozen per process)
 *   X-Wizard-Attempt-Id — short log-friendly attempt id (rotates on retry)
 *   X-Wizard-Session-Id — session-scoped id (analytics device id)
 *   X-Wizard-Version    — wizard CLI version
 *   X-Wizard-Mode       — interactive | ci | agent
 *   X-Wizard-Integration— detected framework key (if available)
 *
 * Callers typically spread the result into an existing `headers` object:
 *
 *   headers: { ...createTracingHeaders({ integration }), Authorization, ... }
 */
export function createTracingHeaders(opts?: {
  integration?: string | null;
}): Record<string, string> {
  const traceparent = `00-${getRunIdHex()}-${getAttemptIdHex()}-01`;
  const headers: Record<string, string> = {
    traceparent,
    'X-Wizard-Run-Id': getRunId(),
    'X-Wizard-Attempt-Id': getAttemptId(),
    'X-Wizard-Session-Id': getSessionId(),
    'X-Wizard-Version': VERSION,
    'X-Wizard-Mode': getExecutionMode(),
  };
  if (opts?.integration) {
    headers['X-Wizard-Integration'] = opts.integration;
  }
  return headers;
}
