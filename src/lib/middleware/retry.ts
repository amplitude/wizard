/**
 * Retry middleware — surfaces Claude Agent SDK `api_retry` system messages
 * as transient UI state. The SDK emits these while retrying against a flaky
 * upstream (typically 504s from the LLM proxy) with backoff. Without this
 * middleware the user just sees a stuck spinner.
 *
 * Any non-retry message clears the state, so the banner goes away as soon as
 * a real response arrives.
 */

import type { RetryState } from '../wizard-session';
import type { Middleware, SDKMessage } from './types';

/** Default cap when the SDK doesn't include `max_retries`. */
const FALLBACK_MAX_RETRIES = 10;

function reasonForStatus(status: number | null): string {
  if (status === null) return 'Reconnecting';
  if (status >= 500) return 'Amplitude gateway error';
  if (status === 429) return 'Rate limited — backing off';
  if (status >= 400) return 'Upstream error';
  return 'Unexpected response';
}

function parseRetryMessage(message: SDKMessage): RetryState | null {
  if (message.type !== 'system' || message.subtype !== 'api_retry') {
    return null;
  }
  const raw = message as Record<string, unknown>;
  const attemptFromSdk = typeof raw.attempt === 'number' ? raw.attempt : 0;
  // SDK reports zero-based attempt numbers; display them 1-indexed.
  const attempt = Math.max(1, attemptFromSdk + 1);
  const maxRetries =
    typeof raw.max_retries === 'number'
      ? raw.max_retries
      : FALLBACK_MAX_RETRIES;
  const retryDelayMs =
    typeof raw.retry_delay_ms === 'number' ? raw.retry_delay_ms : 0;
  const errorStatus =
    typeof raw.error_status === 'number' ? raw.error_status : null;
  const now = Date.now();
  return {
    attempt,
    maxRetries,
    nextRetryAtMs: now + retryDelayMs,
    errorStatus,
    reason: reasonForStatus(errorStatus),
    startedAt: now,
  };
}

/**
 * Build a middleware that publishes retry state transitions. The callback
 * fires with a {@link RetryState} when an `api_retry` message arrives and
 * with `null` when a normal agent message arrives after a retry.
 */
export function createRetryMiddleware(
  onState: (state: RetryState | null) => void,
): Middleware {
  let active = false;
  return {
    name: 'retry',
    onMessage(message: SDKMessage) {
      const next = parseRetryMessage(message);
      if (next) {
        active = true;
        onState(next);
        return;
      }
      if (active) {
        active = false;
        onState(null);
      }
    },
  };
}
