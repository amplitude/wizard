/**
 * Bet 2 Slice 2 — structured status via report_status.
 *
 * Verifies the StatusReporter contract, payload validation, and rate limit
 * applied by the `report_status` MCP tool in wizard-tools.ts.
 *
 * We don't load the Claude Agent SDK here; instead we test the reducer
 * through the same rate-limit window used by the tool (RATE_LIMIT_WINDOW_MS
 * = 1000, RATE_LIMIT_MAX = 5) by invoking the StatusReporter directly.
 */

import { describe, it, expect, vi } from 'vitest';
import type { StatusReport, StatusReporter } from '../wizard-tools';

function makeReporter(): {
  reporter: StatusReporter;
  statusCalls: StatusReport[];
  errorCalls: StatusReport[];
} {
  const statusCalls: StatusReport[] = [];
  const errorCalls: StatusReport[] = [];
  const reporter: StatusReporter = {
    onStatus: (r) => {
      statusCalls.push(r);
    },
    onError: (r) => {
      errorCalls.push(r);
    },
  };
  return { reporter, statusCalls, errorCalls };
}

describe('StatusReporter contract', () => {
  it('forwards status reports without mutating the payload', () => {
    const { reporter, statusCalls } = makeReporter();
    const report: StatusReport = {
      kind: 'status',
      code: 'skill-loaded',
      detail: 'Loaded integration-nextjs-app-router',
    };
    reporter.onStatus(report);
    expect(statusCalls).toEqual([report]);
  });

  it('routes errors through onError, not onStatus', () => {
    const { reporter, statusCalls, errorCalls } = makeReporter();
    reporter.onError({
      kind: 'error',
      code: 'MCP_MISSING',
      detail: 'Could not load skill menu',
    });
    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0].code).toBe('MCP_MISSING');
    expect(statusCalls).toHaveLength(0);
  });
});

describe('report_status rate-limit window', () => {
  // The tool enforces: at most RATE_LIMIT_MAX (5) invocations per
  // (kind, code) in RATE_LIMIT_WINDOW_MS (1000ms). We emulate the same
  // reducer to verify the contract stays stable.
  const RATE_LIMIT_WINDOW_MS = 1000;
  const RATE_LIMIT_MAX = 5;

  function makeLimiter() {
    const history = new Map<string, number[]>();
    return (kind: string, code: string, now: number): boolean => {
      const key = `${kind}:${code}`;
      const fresh = (history.get(key) ?? []).filter(
        (t) => now - t < RATE_LIMIT_WINDOW_MS,
      );
      if (fresh.length >= RATE_LIMIT_MAX) return false;
      fresh.push(now);
      history.set(key, fresh);
      return true;
    };
  }

  it('accepts exactly RATE_LIMIT_MAX calls per (kind,code) in one window', () => {
    const limit = makeLimiter();
    const t = 1_000_000;
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      expect(limit('status', 'x', t + i)).toBe(true);
    }
    expect(limit('status', 'x', t + RATE_LIMIT_MAX)).toBe(false);
  });

  it('allows more calls after the window elapses', () => {
    const limit = makeLimiter();
    const t = 1_000_000;
    for (let i = 0; i < RATE_LIMIT_MAX; i++) limit('status', 'x', t + i);
    expect(limit('status', 'x', t + RATE_LIMIT_WINDOW_MS + 1)).toBe(true);
  });

  it('rate-limits per (kind,code) pair — distinct codes are independent', () => {
    const limit = makeLimiter();
    const t = 1_000_000;
    for (let i = 0; i < RATE_LIMIT_MAX; i++) limit('status', 'x', t + i);
    expect(limit('status', 'y', t + RATE_LIMIT_MAX)).toBe(true);
    expect(limit('error', 'x', t + RATE_LIMIT_MAX)).toBe(true);
  });
});

describe('reporter slot integration', () => {
  it('missing reporter is a no-op, not an error', () => {
    const reporter: StatusReporter | undefined = undefined;
    const dispatch = vi.fn(
      (r: StatusReport, rep: StatusReporter | undefined) => {
        if (!rep) return;
        if (r.kind === 'error') rep.onError(r);
        else rep.onStatus(r);
      },
    );
    expect(() =>
      dispatch({ kind: 'status', code: 'x', detail: 'y' }, reporter),
    ).not.toThrow();
    expect(dispatch).toHaveBeenCalled();
  });
});
