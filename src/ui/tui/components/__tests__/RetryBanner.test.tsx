/**
 * RetryStatusChip — coverage for the calm inline retry indicator.
 *
 * The chip used to be a loud amber banner that fired on every transient
 * 429/504. This suite locks down the new contract:
 *
 *   - Hidden during the {@link RETRY_GRACE_MS} grace period — quick blips
 *     don't reach the user.
 *   - Status-code copy is softened ("slowing down…", "reconnecting…") and
 *     the raw HTTP code is never surfaced.
 *   - Attempt counter is suppressed for the common case; only kicks in as a
 *     muted "still trying" suffix once a retry storm starts to look real.
 *   - Renders inline (no `marginTop` row) so it can sit next to the elapsed
 *     timer in the run-header gap row.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import {
  RetryStatusChip,
  RetryBanner,
  getRetryStatusText,
  backoffSecondsFromState,
  RETRY_GRACE_MS,
} from '../RetryBanner.js';
import type { RetryState } from '../../../../lib/wizard-session.js';
import { frameOf } from '../../__tests__/helpers/render-frame.js';

const baseRetry = (overrides: Partial<RetryState> = {}): RetryState => ({
  attempt: 2,
  maxRetries: 10,
  nextRetryAtMs: 0,
  errorStatus: 429,
  reason: 'Rate limited — backing off',
  startedAt: 0,
  ...overrides,
});

describe('getRetryStatusText (pure helper)', () => {
  it('returns null when retryState is null', () => {
    expect(getRetryStatusText(null, 0)).toBeNull();
  });

  it('returns null inside the grace window', () => {
    const retry = baseRetry({ startedAt: 1_000 });
    // 2s elapsed — under the 3s grace window.
    expect(getRetryStatusText(retry, 1_000 + 2_000)).toBeNull();
  });

  it('returns soft 429 copy after the grace window', () => {
    const retry = baseRetry({ errorStatus: 429, startedAt: 0 });
    const text = getRetryStatusText(retry, RETRY_GRACE_MS + 1);
    expect(text).toBe('slowing down to match Amplitude rate limits');
  });

  it('returns soft 5xx copy after the grace window', () => {
    const retry = baseRetry({ errorStatus: 503, startedAt: 0 });
    expect(getRetryStatusText(retry, RETRY_GRACE_MS + 1)).toBe(
      'reconnecting to Amplitude',
    );
  });

  it('returns generic "reconnecting" when errorStatus is null', () => {
    const retry = baseRetry({ errorStatus: null, startedAt: 0 });
    expect(getRetryStatusText(retry, RETRY_GRACE_MS + 1)).toBe('reconnecting');
  });

  it('appends "still trying" once attempts cross the sustained threshold', () => {
    const retry = baseRetry({ errorStatus: 429, attempt: 5, startedAt: 0 });
    expect(getRetryStatusText(retry, RETRY_GRACE_MS + 1)).toBe(
      'slowing down to match Amplitude rate limits (still trying)',
    );
  });

  it('does NOT append "still trying" below the threshold', () => {
    const retry = baseRetry({ errorStatus: 429, attempt: 4, startedAt: 0 });
    expect(getRetryStatusText(retry, RETRY_GRACE_MS + 1)).not.toContain(
      'still trying',
    );
  });

  // ── Sustained-storm backoff countdown ────────────────────────────────
  //
  // Once a retry storm crosses the sustained threshold (attempt ≥ 5), the
  // chip MAY append a concrete "next in Ns" tail when the retry state
  // carries a useful `nextRetryAtMs`. This answers the implicit "is it
  // actually still working?" question users ask once they've been
  // staring at the chip long enough to want a number. We deliberately
  // do NOT show the X/Y attempt fraction — calm copy is still calm.

  it('appends "next in Ns" backoff when sustained AND a future nextRetryAtMs is known', () => {
    const now = 10_000;
    const retry = baseRetry({
      errorStatus: 429,
      attempt: 5,
      startedAt: 0,
      nextRetryAtMs: now + 4_000,
    });
    expect(getRetryStatusText(retry, now)).toBe(
      'slowing down to match Amplitude rate limits (still trying — next in 4s)',
    );
  });

  it('still uses the plain "still trying" tail when nextRetryAtMs is unset', () => {
    const retry = baseRetry({
      errorStatus: 429,
      attempt: 5,
      startedAt: 0,
      nextRetryAtMs: 0,
    });
    expect(getRetryStatusText(retry, RETRY_GRACE_MS + 1)).toBe(
      'slowing down to match Amplitude rate limits (still trying)',
    );
  });

  it('still uses the plain "still trying" tail when nextRetryAtMs is in the past', () => {
    const now = 10_000;
    const retry = baseRetry({
      errorStatus: 429,
      attempt: 6,
      startedAt: 0,
      nextRetryAtMs: now - 500,
    });
    expect(getRetryStatusText(retry, now)).toBe(
      'slowing down to match Amplitude rate limits (still trying)',
    );
  });

  it('does NOT append the backoff tail below the sustained threshold', () => {
    const now = 10_000;
    const retry = baseRetry({
      errorStatus: 429,
      attempt: 4,
      startedAt: 0,
      nextRetryAtMs: now + 4_000,
    });
    expect(getRetryStatusText(retry, now)).toBe(
      'slowing down to match Amplitude rate limits',
    );
  });
});

describe('backoffSecondsFromState (pure helper)', () => {
  it('returns null when nextRetryAtMs is unset', () => {
    expect(
      backoffSecondsFromState(baseRetry({ nextRetryAtMs: 0 }), 0),
    ).toBeNull();
  });

  it('returns null when nextRetryAtMs is in the past', () => {
    expect(
      backoffSecondsFromState(baseRetry({ nextRetryAtMs: 5_000 }), 6_000),
    ).toBeNull();
  });

  it('rounds DOWN so the user never waits longer than advertised', () => {
    // 3.9s remaining — show 3, not 4.
    expect(
      backoffSecondsFromState(baseRetry({ nextRetryAtMs: 3_900 }), 0),
    ).toBe(3);
  });

  it('clamps to a minimum of 1s while there is still time on the clock', () => {
    // Sub-second tail — we don't want a misleading "0s" countdown right
    // before the retry fires.
    expect(backoffSecondsFromState(baseRetry({ nextRetryAtMs: 500 }), 0)).toBe(
      1,
    );
  });
});

describe('getRetryStatusText (calm invariants)', () => {
  it('never surfaces a raw HTTP code', () => {
    for (const status of [400, 401, 429, 500, 503, 504]) {
      const text = getRetryStatusText(
        baseRetry({ errorStatus: status, startedAt: 0 }),
        RETRY_GRACE_MS + 1,
      );
      expect(text).not.toBeNull();
      expect(text!).not.toContain('HTTP');
      expect(text!).not.toContain(String(status));
    }
  });

  // Existing invariant: calm copy must never show an X/Y attempt fraction.
  // The sustained-storm path may add a "next in Ns" suffix when a useful
  // nextRetryAtMs is known, but the attempt-count fraction stays hidden —
  // users don't read counters, they read context.
  it('never surfaces an attempt counter fraction', () => {
    const text = getRetryStatusText(
      baseRetry({ attempt: 6, maxRetries: 10, startedAt: 0 }),
      RETRY_GRACE_MS + 1,
    );
    expect(text).not.toMatch(/\d+\/\d+/);
  });
});

describe('RetryStatusChip', () => {
  it('renders nothing when retryState is null', () => {
    expect(frameOf(<RetryStatusChip retryState={null} now={0} />)).toBe('');
  });

  it('renders nothing during the grace window', () => {
    const retry = baseRetry({ startedAt: 0 });
    expect(frameOf(<RetryStatusChip retryState={retry} now={1_500} />)).toBe(
      '',
    );
  });

  it('renders a muted chip after the grace window', () => {
    const retry = baseRetry({ errorStatus: 429, startedAt: 0 });
    const out = frameOf(
      <RetryStatusChip retryState={retry} now={RETRY_GRACE_MS + 1} />,
    );
    expect(out).toContain('slowing down to match Amplitude rate limits');
    // No countdown — spinner conveys liveness.
    expect(out).not.toContain('next in');
  });

  it('exports the legacy RetryBanner name as an alias', () => {
    // Keep external imports compiling.
    expect(RetryBanner).toBe(RetryStatusChip);
  });
});
