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
import { analytics } from '../../utils/analytics';

/** Default cap when the SDK doesn't include `max_retries`. */
const FALLBACK_MAX_RETRIES = 10;

function reasonForStatus(status: number | null): string {
  if (status === null) return 'Reconnecting';
  if (status >= 500) return 'Amplitude gateway error';
  if (status === 429) return 'Rate limited — backing off';
  if (status >= 400) return 'Upstream error';
  return 'Unexpected response';
}

function parseRetryMessage(
  message: SDKMessage,
  stormStartedAt: number,
): RetryState | null {
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
    // Anchor `startedAt` to the *first* retry of the current storm — not
    // this individual message — so consumers can measure "how long has this
    // been going on" for grace-period decisions. Reset on the next normal
    // message (see `active` reset below).
    startedAt: stormStartedAt,
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
  let stormStartedAt = 0;
  return {
    name: 'retry',
    onMessage(message: SDKMessage) {
      // Only stamp the storm-start timestamp on the *first* retry of a run.
      // Subsequent retries reuse it, so `startedAt` keeps climbing relative
      // to `now` and the banner can decide "this has lasted long enough to
      // bother the user".
      const tentativeStart = active ? stormStartedAt : Date.now();
      const next = parseRetryMessage(message, tentativeStart);
      if (next) {
        if (!active) stormStartedAt = tentativeStart;
        active = true;
        onState(next);
        analytics.wizardCapture('llm retry', {
          attempt: next.attempt,
          'max retries': next.maxRetries,
          'error status': next.errorStatus,
          reason: next.reason,
          'retry delay ms': Math.max(0, next.nextRetryAtMs - Date.now()),
        });
        return;
      }
      if (active) {
        active = false;
        stormStartedAt = 0;
        onState(null);
      }
    },
  };
}
