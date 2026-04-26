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
import { render } from 'ink-testing-library';
import {
  RetryStatusChip,
  RetryBanner,
  getRetryStatusText,
  RETRY_GRACE_MS,
} from '../RetryBanner.js';
import type { RetryState } from '../../../../lib/wizard-session.js';

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const stripAnsi = (s: string): string => s.replace(ANSI, '');

function frameOf(node: React.ReactElement): string {
  const { lastFrame, unmount } = render(node);
  const out = stripAnsi(lastFrame() ?? '');
  unmount();
  return out;
}

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
