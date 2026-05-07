/**
 * Regression tests for OAuth callback CSRF / state-validation hardening.
 *
 * The bug we are guarding against: prior to this change, the callback handler
 * accepted ANY state value (or no state at all) and would happily forward the
 * `code` query param into the token-exchange step. That allowed an attacker to
 * race a malicious callback against a legitimate user's flow and inject their
 * own auth code.
 *
 * These tests exercise the raw HTTP server returned by `startCallbackServer`
 * — they do not run the full browser-driven OAuth dance.
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { AddressInfo } from 'node:net';
import { startCallbackServer } from '../oauth.js';

// startCallbackServer hardcodes OAUTH_PORT, so we can only safely run one
// instance at a time. Each test owns the lifecycle of its server.
async function fetchCallback(
  port: number,
  query: string,
): Promise<{ status: number }> {
  const res = await fetch(`http://127.0.0.1:${port}/callback?${query}`);
  // Drain body so the connection can close cleanly
  await res.text();
  return { status: res.status };
}

describe('startCallbackServer state validation', () => {
  let cleanup: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = null;
    }
  });

  it('rejects callback with mismatched state', async () => {
    const { server, waitForCallback } = await startCallbackServer();
    const port = (server.address() as AddressInfo).port;
    cleanup = async () =>
      new Promise<void>((resolve) => server.close(() => resolve()));

    const callbackPromise = waitForCallback('expected-state-abc');
    // Don't let unhandled rejection break the test runner
    callbackPromise.catch(() => undefined);

    const { status } = await fetchCallback(
      port,
      'code=stolen&state=attacker-state',
    );

    expect(status).toBe(400);
    await expect(callbackPromise).rejects.toThrow(/state mismatch/i);
  });

  it('rejects callback with missing state', async () => {
    const { server, waitForCallback } = await startCallbackServer();
    const port = (server.address() as AddressInfo).port;
    cleanup = async () =>
      new Promise<void>((resolve) => server.close(() => resolve()));

    const callbackPromise = waitForCallback('expected-state-xyz');
    callbackPromise.catch(() => undefined);

    const { status } = await fetchCallback(port, 'code=stolen');

    expect(status).toBe(400);
    await expect(callbackPromise).rejects.toThrow(/state mismatch/i);
  });

  it('accepts callback with matching state', async () => {
    const { server, waitForCallback } = await startCallbackServer();
    const port = (server.address() as AddressInfo).port;
    cleanup = async () =>
      new Promise<void>((resolve) => server.close(() => resolve()));

    const callbackPromise = waitForCallback('matching-state');

    const { status } = await fetchCallback(
      port,
      'code=good-code&state=matching-state',
    );

    expect(status).toBe(200);
    await expect(callbackPromise).resolves.toBe('good-code');
  });

  it('binds to loopback only', async () => {
    const { server } = await startCallbackServer();
    cleanup = async () =>
      new Promise<void>((resolve) => server.close(() => resolve()));

    const addr = server.address() as AddressInfo;
    expect(addr.address).toBe('127.0.0.1');
  });
});

// ── Hotfix regression tests — TUI signal ordering ───────────────────────
// vi.mock calls are hoisted to the top of the module, so they MUST live
// at file scope (not inside a describe block) — otherwise hoisting moves
// them before our local helpers exist. We register the mocks here, then
// import the production module lazily inside each test.

const callOrder: string[] = [];

vi.mock('opn', () => ({
  default: (..._args: unknown[]) => {
    callOrder.push('opn');
    // Mimic opn's promise-with-.catch shape — production code uses
    // `opn(url, opts).catch(() => {})`.
    return {
      catch: (_fn: (e: unknown) => void) => undefined,
    };
  },
}));

// Mock getUI() to capture the call sequence on the UI singleton without
// pulling in the full TUI store. Each interesting method records its
// name so the test can assert ordering.
vi.mock('../../ui/index.js', () => {
  const fakeSpinner = {
    start: () => undefined,
    stop: () => undefined,
    update: () => undefined,
  };
  return {
    getUI: () => ({
      log: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
      spinner: () => fakeSpinner,
      setLoginUrl: (url: string | null) => {
        callOrder.push(url ? 'setLoginUrl(url)' : 'setLoginUrl(null)');
      },
      setAuthPhase: (phase: string) => {
        callOrder.push(`setAuthPhase(${phase})`);
      },
    }),
  };
});

// Force the no-cached-token branch so the fresh-OAuth flow runs.
vi.mock('../ampli-settings.js', () => ({
  getStoredToken: () => null,
  storeToken: () => undefined,
}));

// abort() calls process.exit in production — stub it.
vi.mock('./setup-utils.js', () => ({ abort: () => undefined }));
vi.mock('../setup-utils.js', () => ({ abort: () => undefined }));

describe('performAmplitudeAuth — TUI signal ordering', () => {
  // oauth.ts skips the opn() call when NODE_ENV === 'test' (vitest sets it)
  // so we have to flip it for this suite. Restored in afterEach.
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    callOrder.length = 0;
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'oauth-order-test';
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  /**
   * Drive the fresh-OAuth path long enough to observe the early signals
   * (setAuthPhase + setLoginUrl + opn), then abort to release the
   * callback-server port. Returns the captured call order.
   */
  async function captureEarlySignals(): Promise<string[]> {
    const { performAmplitudeAuth } = await import('../oauth.js');
    const ac = new AbortController();
    const auth = performAmplitudeAuth({ zone: 'us', signal: ac.signal }).catch(
      () => undefined,
    );
    // Yield enough microtasks for the awaited startCallbackServer + the
    // synchronous setAuthPhase + setLoginUrl + opn calls to all run.
    await new Promise((r) => setTimeout(r, 50));
    ac.abort();
    await auth;
    return [...callOrder];
  }

  it('calls setLoginUrl(url) BEFORE opn() so the URL is always copyable', async () => {
    const order = await captureEarlySignals();
    const setLoginUrlIdx = order.findIndex((c) => c === 'setLoginUrl(url)');
    const opnIdx = order.indexOf('opn');
    expect(
      setLoginUrlIdx,
      `expected setLoginUrl(url) in ${JSON.stringify(order)}`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      opnIdx,
      `expected opn in ${JSON.stringify(order)}`,
    ).toBeGreaterThanOrEqual(0);
    // The whole point of this test: URL exposed to the user FIRST so they
    // can copy/paste it even if opn() fails to launch a browser.
    expect(setLoginUrlIdx).toBeLessThan(opnIdx);
  });

  it("flips authPhase to 'opening-browser' before constructing the URL", async () => {
    const order = await captureEarlySignals();
    const phaseIdx = order.findIndex(
      (c) => c === 'setAuthPhase(opening-browser)',
    );
    const urlIdx = order.findIndex((c) => c === 'setLoginUrl(url)');
    expect(phaseIdx).toBeGreaterThanOrEqual(0);
    expect(urlIdx).toBeGreaterThanOrEqual(0);
    expect(phaseIdx).toBeLessThan(urlIdx);
  });
});
