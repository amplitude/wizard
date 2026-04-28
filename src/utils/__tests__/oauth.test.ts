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

import { describe, it, expect, afterEach } from 'vitest';
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
