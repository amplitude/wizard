import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

import { exec } from 'child_process';
import {
  detectBoundPort,
  getListeningPid,
  getProcessCwd,
  isSameOrDescendant,
} from '../port-detection';

type ExecCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;

/**
 * Register a fake `exec` implementation. The handler receives the command
 * string and a callback; it should invoke the callback with (error, stdout).
 */
function mockExec(
  handler: (command: string, callback: ExecCallback) => void,
): void {
  vi.mocked(exec).mockImplementation(((
    command: string,
    _optsOrCallback: unknown,
    callback?: ExecCallback,
  ) => {
    const cb =
      typeof _optsOrCallback === 'function'
        ? (_optsOrCallback as ExecCallback)
        : (callback as ExecCallback);
    handler(command, cb);
    return { on: () => undefined } as never;
  }) as unknown as typeof exec);
}

beforeEach(() => {
  vi.mocked(exec).mockReset();
});

describe('getListeningPid', () => {
  it('parses the PID from lsof -Fp output', async () => {
    mockExec((_cmd, cb) => cb(null, 'p1234\n', ''));
    await expect(getListeningPid(3000)).resolves.toBe(1234);
  });

  it('returns null when lsof exits non-zero (no match)', async () => {
    mockExec((_cmd, cb) => cb(new Error('exit 1'), '', ''));
    await expect(getListeningPid(9999)).resolves.toBeNull();
  });

  it('returns null when stdout has no p-line', async () => {
    mockExec((_cmd, cb) => cb(null, '', ''));
    await expect(getListeningPid(3000)).resolves.toBeNull();
  });

  it('rejects invalid ports without shelling out', async () => {
    await expect(getListeningPid(0)).resolves.toBeNull();
    await expect(getListeningPid(70000)).resolves.toBeNull();
    await expect(getListeningPid(-1)).resolves.toBeNull();
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('getProcessCwd', () => {
  it('parses the cwd path from lsof -Fn output', async () => {
    mockExec((_cmd, cb) => cb(null, 'p1234\nn/Users/kelson/project\n', ''));
    await expect(getProcessCwd(1234)).resolves.toBe('/Users/kelson/project');
  });

  it('returns null when lsof fails', async () => {
    mockExec((_cmd, cb) => cb(new Error('boom'), '', ''));
    await expect(getProcessCwd(1234)).resolves.toBeNull();
  });

  it('rejects invalid PIDs', async () => {
    await expect(getProcessCwd(0)).resolves.toBeNull();
    await expect(getProcessCwd(-1)).resolves.toBeNull();
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('isSameOrDescendant', () => {
  it('matches the same path', () => {
    expect(isSameOrDescendant('/a/b', '/a/b')).toBe(true);
  });

  it('matches a descendant', () => {
    expect(isSameOrDescendant('/a/b/c', '/a/b')).toBe(true);
    expect(isSameOrDescendant('/a/b/c/d', '/a/b')).toBe(true);
  });

  it('rejects a sibling with a shared prefix', () => {
    expect(isSameOrDescendant('/a/bc', '/a/b')).toBe(false);
  });

  it('rejects an ancestor', () => {
    expect(isSameOrDescendant('/a', '/a/b')).toBe(false);
  });

  it('matches through symlinks by canonicalizing both sides', async () => {
    const { mkdtempSync, mkdirSync, symlinkSync, rmSync } = await import('fs');
    const os = await import('os');
    const real = mkdtempSync(path.join(os.tmpdir(), 'port-real-'));
    const sub = path.join(real, 'app');
    mkdirSync(sub);
    const link = path.join(os.tmpdir(), `port-link-${Date.now()}`);
    try {
      symlinkSync(real, link);
      // child via symlink, parent via real path → should still match
      expect(isSameOrDescendant(path.join(link, 'app'), real)).toBe(true);
      // both via symlink
      expect(isSameOrDescendant(path.join(link, 'app'), link)).toBe(true);
    } finally {
      rmSync(link, { force: true });
      rmSync(real, { recursive: true, force: true });
    }
  });
});

describe('detectBoundPort', () => {
  it('returns the first bound port when no cwd filter is applied', async () => {
    mockExec((cmd, cb) => {
      if (cmd.includes(':3001')) cb(null, 'p1234\n', '');
      else cb(new Error('exit 1'), '', '');
    });
    await expect(detectBoundPort([3000, 3001, 3002])).resolves.toBe(3001);
  });

  it('accepts a port whose listener cwd matches the install dir', async () => {
    mockExec((cmd, cb) => {
      if (cmd.startsWith('lsof -iTCP:3000')) cb(null, 'p1234\n', '');
      else if (cmd.startsWith('lsof -p 1234'))
        cb(null, 'p1234\nn/Users/kelson/project\n', '');
      else cb(new Error('exit 1'), '', '');
    });
    await expect(
      detectBoundPort([3000], { cwd: '/Users/kelson/project' }),
    ).resolves.toBe(3000);
  });

  it('accepts a listener running from a subdirectory of the install dir', async () => {
    mockExec((cmd, cb) => {
      if (cmd.startsWith('lsof -iTCP:3000')) cb(null, 'p1234\n', '');
      else if (cmd.startsWith('lsof -p 1234'))
        cb(null, 'p1234\nn/Users/kelson/project/web\n', '');
      else cb(new Error('exit 1'), '', '');
    });
    await expect(
      detectBoundPort([3000], { cwd: '/Users/kelson/project' }),
    ).resolves.toBe(3000);
  });

  it('rejects a listener whose cwd is unrelated to the install dir', async () => {
    mockExec((cmd, cb) => {
      if (cmd.startsWith('lsof -iTCP:3000')) cb(null, 'p1234\n', '');
      else if (cmd.startsWith('lsof -p 1234'))
        cb(null, 'p1234\nn/Users/kelson/other-app\n', '');
      else cb(new Error('exit 1'), '', '');
    });
    await expect(
      detectBoundPort([3000], { cwd: '/Users/kelson/project' }),
    ).resolves.toBeNull();
  });

  it('falls through to the next candidate when the current one fails the cwd check', async () => {
    mockExec((cmd, cb) => {
      if (cmd.startsWith('lsof -iTCP:3000')) cb(null, 'p1111\n', '');
      else if (cmd.startsWith('lsof -p 1111'))
        cb(null, 'p1111\nn/somewhere/else\n', '');
      else if (cmd.startsWith('lsof -iTCP:3001')) cb(null, 'p2222\n', '');
      else if (cmd.startsWith('lsof -p 2222'))
        cb(null, 'p2222\nn/Users/kelson/project\n', '');
      else cb(new Error('exit 1'), '', '');
    });
    await expect(
      detectBoundPort([3000, 3001], { cwd: '/Users/kelson/project' }),
    ).resolves.toBe(3001);
  });

  it('rejects a port whose PID has no resolvable cwd', async () => {
    mockExec((cmd, cb) => {
      if (cmd.startsWith('lsof -iTCP:3000')) cb(null, 'p1234\n', '');
      else cb(new Error('lsof -p failed'), '', '');
    });
    await expect(
      detectBoundPort([3000], { cwd: '/Users/kelson/project' }),
    ).resolves.toBeNull();
  });

  it('returns null for an empty candidate list', async () => {
    await expect(detectBoundPort([])).resolves.toBeNull();
    expect(exec).not.toHaveBeenCalled();
  });
});
