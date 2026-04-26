/**
 * RetryBanner — regression coverage for the agent retry banner.
 *
 * The banner is shown on RunScreen during transient LLM/proxy retries (504,
 * stalls, etc.). PR #233 surfaced two specific bugs that we want to lock down:
 *
 *   1. The banner renders on a single line — JSX line breaks between
 *      `{expr}` tokens were collapsing to a stray space, producing
 *      "attempt 3/ 10" when the line wrapped.
 *   2. The countdown ETA is omitted (rather than reading "0s") when the
 *      next retry has already started, so the banner doesn't flash a
 *      misleading "next in 0s" frame on the way out.
 *
 * These are pure render-from-props tests — RetryBanner takes no store and
 * no Ink hooks beyond Box/Text, so we render directly.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { RetryBanner } from '../RetryBanner.js';
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
  maxRetries: 5,
  nextRetryAtMs: 0,
  errorStatus: 504,
  reason: 'gateway timeout',
  startedAt: 0,
  ...overrides,
});

describe('RetryBanner', () => {
  it('renders nothing when retryState is null', () => {
    expect(frameOf(<RetryBanner retryState={null} now={0} />)).toBe('');
  });

  it('shows reason, HTTP status, attempt counter, and ETA in seconds', () => {
    const retry = baseRetry({
      attempt: 3,
      maxRetries: 10,
      nextRetryAtMs: 12_500,
      errorStatus: 504,
      reason: 'gateway timeout',
    });
    const out = frameOf(<RetryBanner retryState={retry} now={5_000} />);

    expect(out).toContain('gateway timeout');
    expect(out).toContain('(HTTP 504)');
    // 12.5s − 5s = 7.5s → ceil → 8s
    expect(out).toContain('attempt 3/10, next in 8s');
  });

  it('renders the attempt counter on a single visual run (no internal split)', () => {
    // The bug being guarded: JSX whitespace between `{}` tokens used to
    // turn "attempt 3/10" into "attempt 3/ 10" once the banner wrapped.
    const out = frameOf(
      <RetryBanner
        retryState={baseRetry({ attempt: 3, maxRetries: 10 })}
        now={0}
      />,
    );
    expect(out).not.toMatch(/attempt 3\/\s+10/);
    expect(out).toContain('attempt 3/10');
  });

  it('omits HTTP status when errorStatus is null (stall, SDK error)', () => {
    const out = frameOf(
      <RetryBanner
        retryState={baseRetry({ errorStatus: null, reason: 'stalled' })}
        now={0}
      />,
    );
    expect(out).toContain('stalled');
    expect(out).not.toContain('HTTP');
  });

  it('omits the ETA when the next retry is already due', () => {
    // When `now` >= nextRetryAtMs we should not flash "next in 0s" — the
    // banner has been kept alive for the next message to clear.
    const out = frameOf(
      <RetryBanner
        retryState={baseRetry({ nextRetryAtMs: 1_000 })}
        now={5_000}
      />,
    );
    expect(out).not.toContain('next in');
    expect(out).toContain('attempt 2/5');
  });

  it('rounds the ETA up so the user never sees fractional seconds', () => {
    // 1499ms remaining → ceil to 2s, never "1.499s" or "1s" (which would be
    // misleadingly low).
    const out = frameOf(
      <RetryBanner retryState={baseRetry({ nextRetryAtMs: 1_499 })} now={0} />,
    );
    expect(out).toContain('next in 2s');
  });
});
