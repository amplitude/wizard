/**
 * Lifecycle tests for the OAuth callback server.
 *
 * Covers:
 *   - the server binds to 127.0.0.1 only (never 0.0.0.0)
 *   - startCallbackServer picks the next free port in the OAUTH_PORT range
 *     when the base port is taken (EADDRINUSE retry)
 *   - OAuthPortInUseError is thrown with helpful copy when every port in the
 *     range is exhausted
 *   - closeServer is idempotent and tolerates a not-listening server
 *   - listen() error handler does not reject the promise after listen succeeds
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import * as http from 'node:http';
import { OAUTH_PORT } from '../../lib/constants';
import {
  __testing,
  OAUTH_PORT_RETRY_LIMIT,
  OAuthPortInUseError,
} from '../oauth';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()!;
    await fn().catch(() => undefined);
  }
});

/** Bind a raw TCP server to a specific port on 127.0.0.1 to simulate "in use". */
async function squat(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

function closeRaw(s: net.Server): Promise<void> {
  return new Promise((resolve) => {
    if (!s.listening) return resolve();
    s.close(() => resolve());
  });
}

describe('startCallbackServer (lifecycle)', () => {
  it('binds to 127.0.0.1 only — not 0.0.0.0 or ::', async () => {
    const handle = await __testing.startCallbackServer();
    cleanups.push(() => __testing.closeServer(handle.server));

    const addr = handle.server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('expected AddressInfo');
    }
    expect(addr.address).toBe('127.0.0.1');
    expect(addr.port).toBe(handle.port);
  });

  it('returns the bound port so callers can build the redirect_uri', async () => {
    const handle = await __testing.startCallbackServer();
    cleanups.push(() => __testing.closeServer(handle.server));

    expect(handle.port).toBeGreaterThanOrEqual(OAUTH_PORT);
    expect(handle.port).toBeLessThanOrEqual(
      OAUTH_PORT + OAUTH_PORT_RETRY_LIMIT,
    );
  });

  it('falls back to OAUTH_PORT+1 when the base port is taken', async () => {
    const squatter = await squat(OAUTH_PORT);
    cleanups.push(() => closeRaw(squatter));

    const handle = await __testing.startCallbackServer();
    cleanups.push(() => __testing.closeServer(handle.server));

    expect(handle.port).toBe(OAUTH_PORT + 1);
  });

  it('walks further down the range when multiple ports are taken', async () => {
    const blockers: net.Server[] = [];
    for (let i = 0; i < 3; i++) {
      const s = await squat(OAUTH_PORT + i);
      blockers.push(s);
    }
    cleanups.push(async () => {
      for (const s of blockers) await closeRaw(s);
    });

    const handle = await __testing.startCallbackServer();
    cleanups.push(() => __testing.closeServer(handle.server));

    expect(handle.port).toBe(OAUTH_PORT + 3);
  });

  it('throws OAuthPortInUseError with helpful copy when the range is exhausted', async () => {
    const blockers: net.Server[] = [];
    for (let i = 0; i <= OAUTH_PORT_RETRY_LIMIT; i++) {
      const s = await squat(OAUTH_PORT + i);
      blockers.push(s);
    }
    cleanups.push(async () => {
      for (const s of blockers) await closeRaw(s);
    });

    await expect(__testing.startCallbackServer()).rejects.toMatchObject({
      name: 'OAuthPortInUseError',
      basePort: OAUTH_PORT,
    });

    try {
      await __testing.startCallbackServer();
    } catch (e) {
      expect(e).toBeInstanceOf(OAuthPortInUseError);
      const err = e as OAuthPortInUseError;
      // User-facing copy mentions the port and tells them what to do.
      expect(err.userMessage).toContain(String(OAUTH_PORT));
      expect(err.userMessage).toMatch(/close.*wizard runs/i);
    }
  });
});

describe('tryStartCallbackServer', () => {
  it('rejects with EADDRINUSE when the port is already bound', async () => {
    const squatter = await squat(OAUTH_PORT + 50);
    cleanups.push(() => closeRaw(squatter));

    await expect(
      __testing.tryStartCallbackServer(OAUTH_PORT + 50),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });

  it('detaches the listen-error handler after listen succeeds', async () => {
    const handle = await __testing.tryStartCallbackServer(OAUTH_PORT + 60);
    cleanups.push(() => __testing.closeServer(handle.server));

    // Once listen resolves, the start-promise's reject handler must be
    // gone — otherwise a runtime error event would re-reject an
    // already-resolved promise (or be the only handler, masking errors).
    // We assert there are no 'error' listeners left from the start promise.
    expect(handle.server.listenerCount('error')).toBe(0);
  });
});

describe('closeServer', () => {
  it('closes a listening server', async () => {
    const handle = await __testing.startCallbackServer();
    expect(handle.server.listening).toBe(true);

    await __testing.closeServer(handle.server);
    expect(handle.server.listening).toBe(false);
  });

  it('is idempotent — closing twice does not throw', async () => {
    const handle = await __testing.startCallbackServer();
    await __testing.closeServer(handle.server);
    await expect(__testing.closeServer(handle.server)).resolves.toBeUndefined();
  });

  it('tolerates a never-listening server', async () => {
    const server = http.createServer();
    await expect(__testing.closeServer(server)).resolves.toBeUndefined();
  });

  it('frees the port so the next bind succeeds', async () => {
    const first = await __testing.startCallbackServer();
    const port = first.port;
    await __testing.closeServer(first.server);

    const second = await __testing.tryStartCallbackServer(port);
    cleanups.push(() => __testing.closeServer(second.server));
    expect(second.port).toBe(port);
  });
});

describe('OAuthPortInUseError', () => {
  it('exposes a userMessage with the configured base port', () => {
    const err = new OAuthPortInUseError(12345);
    expect(err.userMessage).toContain('12345');
    expect(err.userMessage).toMatch(/close.*wizard runs/i);
    expect(err.basePort).toBe(12345);
    expect(err.name).toBe('OAuthPortInUseError');
  });
});
