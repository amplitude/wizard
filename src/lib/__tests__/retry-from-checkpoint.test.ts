/**
 * Retry-from-checkpoint — unit tests.
 *
 * Covers the pure helpers (`pruneArgs`, `buildRetryArgs`) and the spawn
 * orchestration in `retryFromCheckpoint`. Spawn is injected so we don't
 * actually fork node processes during the test run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  pruneArgs,
  buildRetryArgs,
  retryFromCheckpoint,
  clearStaleAgentState,
  type RetryStoreLike,
  type SpawnFn,
} from '../retry-from-checkpoint';

vi.mock('../../utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
  },
}));

import { analytics } from '../../utils/analytics';

// Minimal fake child-process used by the spawn factory tests. Behaves
// like `ChildProcess` enough for the retry helper: emits `exit` after
// callers wire up their listener.
function makeFakeChild(exitCode: number | null = 0) {
  const child = new EventEmitter() as EventEmitter & {
    exitCode: number | null;
  };
  child.exitCode = exitCode;
  // Defer the `exit` so the caller has time to attach listeners.
  setImmediate(() => child.emit('exit', exitCode));
  return child;
}

function makeStore(
  patch: Partial<RetryStoreLike['session']> = {},
): RetryStoreLike {
  return {
    session: {
      installDir: '/tmp/fake-install',
      outroData: { kind: 'error', message: 'boom' } as never,
      integration: 'nextjs' as never,
      ...patch,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('pruneArgs', () => {
  it('strips --api-key with space-separated value', () => {
    const result = pruneArgs(['--ci', '--api-key', 'abc123', '--debug']);
    expect(result).toEqual(['--ci', '--debug']);
  });

  it('strips --api-key=value form', () => {
    const result = pruneArgs(['--ci', '--api-key=abc123', '--debug']);
    expect(result).toEqual(['--ci', '--debug']);
  });

  it('strips --install-dir with space-separated value', () => {
    const result = pruneArgs(['--ci', '--install-dir', '/old/path', '--debug']);
    expect(result).toEqual(['--ci', '--debug']);
  });

  it('strips --install-dir=value form', () => {
    const result = pruneArgs(['--ci', '--install-dir=/old/path', '--debug']);
    expect(result).toEqual(['--ci', '--debug']);
  });

  it('returns identity when nothing to prune', () => {
    expect(pruneArgs(['--debug', '--ci'])).toEqual(['--debug', '--ci']);
  });

  it('handles trailing --api-key with no value (truncated argv)', () => {
    expect(pruneArgs(['--ci', '--api-key'])).toEqual(['--ci']);
  });
});

describe('buildRetryArgs', () => {
  it('appends --install-dir <session.installDir> and prunes api-key', () => {
    const { node, args } = buildRetryArgs(
      '/path/to/bin.js',
      ['--ci', '--api-key', 'xxx', '--debug'],
      '/projects/myapp',
    );
    expect(node).toBe(process.execPath);
    expect(args).toEqual([
      '/path/to/bin.js',
      '--ci',
      '--debug',
      '--install-dir',
      '/projects/myapp',
    ]);
  });

  it('overrides any pre-existing --install-dir in argv', () => {
    const { args } = buildRetryArgs(
      '/path/to/bin.js',
      ['--install-dir', '/wrong/dir'],
      '/projects/myapp',
    );
    expect(args).toEqual([
      '/path/to/bin.js',
      '--install-dir',
      '/projects/myapp',
    ]);
  });
});

describe('retryFromCheckpoint', () => {
  it('spawns node with the wizard bin, propagates exit code, and tracks analytics', async () => {
    const fakeSpawn = vi.fn(() => makeFakeChild(0)) as unknown as SpawnFn;
    const store = makeStore();

    const code = await retryFromCheckpoint(store, {
      binPath: '/wizard/bin.js',
      rawArgs: ['--ci', '--api-key', 'XXX'],
      spawnFn: fakeSpawn,
      skipExit: true,
    });

    expect(code).toBe(0);
    expect(fakeSpawn).toHaveBeenCalledTimes(1);
    const [node, args, opts] = (fakeSpawn as unknown as vi.Mock).mock.calls[0];
    expect(node).toBe(process.execPath);
    expect(args[0]).toBe('/wizard/bin.js');
    expect(args).toContain('--ci');
    expect(args).not.toContain('--api-key');
    expect(args).not.toContain('XXX');
    expect(args).toContain('--install-dir');
    expect(args).toContain('/tmp/fake-install');
    expect(opts).toMatchObject({ stdio: 'inherit', detached: false });
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'error outro retry pressed',
      expect.objectContaining({ 'outro kind': 'error' }),
    );
  });

  it('propagates non-zero exit codes from the child', async () => {
    const fakeSpawn = vi.fn(() => makeFakeChild(7)) as unknown as SpawnFn;
    const code = await retryFromCheckpoint(makeStore(), {
      binPath: '/wizard/bin.js',
      rawArgs: [],
      spawnFn: fakeSpawn,
      skipExit: true,
    });
    expect(code).toBe(7);
  });

  it('treats null exit (signal-killed child) as exit 1', async () => {
    const fakeSpawn = vi.fn(() => makeFakeChild(null)) as unknown as SpawnFn;
    const code = await retryFromCheckpoint(makeStore(), {
      binPath: '/wizard/bin.js',
      rawArgs: [],
      spawnFn: fakeSpawn,
      skipExit: true,
    });
    expect(code).toBe(1);
  });

  it('returns exit code 1 when binPath is missing', async () => {
    const fakeSpawn = vi.fn() as unknown as SpawnFn;
    const code = await retryFromCheckpoint(makeStore(), {
      binPath: '',
      rawArgs: [],
      spawnFn: fakeSpawn,
      skipExit: true,
    });
    expect(code).toBe(1);
    expect(fakeSpawn).not.toHaveBeenCalled();
  });

  it('returns exit code 1 when spawn itself throws', async () => {
    const fakeSpawn = vi.fn(() => {
      throw new Error('ENOENT');
    }) as unknown as SpawnFn;
    const code = await retryFromCheckpoint(makeStore(), {
      binPath: '/wizard/bin.js',
      rawArgs: [],
      spawnFn: fakeSpawn,
      skipExit: true,
    });
    expect(code).toBe(1);
  });

  it('also works when no checkpoint exists — the child handles a null load itself', async () => {
    // The retry helper does NOT inspect the checkpoint; it just relaunches
    // the wizard. If the child's own loadCheckpoint returns null, the
    // wizard starts fresh — which is the documented best-effort behavior.
    // This test simply verifies the helper doesn't short-circuit on a
    // missing checkpoint.
    const fakeSpawn = vi.fn(() => makeFakeChild(0)) as unknown as SpawnFn;
    const code = await retryFromCheckpoint(makeStore(), {
      binPath: '/wizard/bin.js',
      rawArgs: [],
      spawnFn: fakeSpawn,
      skipExit: true,
    });
    expect(code).toBe(0);
    expect(fakeSpawn).toHaveBeenCalled();
  });
});

describe('clearStaleAgentState', () => {
  it('is a no-op when the state directory does not exist', () => {
    // Override the cache root to a path that definitely doesn't exist.
    const original = process.env.AMPLITUDE_WIZARD_CACHE_DIR;
    process.env.AMPLITUDE_WIZARD_CACHE_DIR =
      '/tmp/wizard-retry-nonexistent-' + Date.now();
    try {
      expect(() => clearStaleAgentState()).not.toThrow();
    } finally {
      if (original === undefined) {
        delete process.env.AMPLITUDE_WIZARD_CACHE_DIR;
      } else {
        process.env.AMPLITUDE_WIZARD_CACHE_DIR = original;
      }
    }
  });
});
