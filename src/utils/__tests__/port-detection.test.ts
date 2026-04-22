import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

import { exec } from 'child_process';
import { detectBoundPort, isPortBound } from '../port-detection';

type ExecCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;

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

describe('isPortBound', () => {
  beforeEach(() => {
    vi.mocked(exec).mockReset();
  });

  it('returns true when lsof prints a LISTEN line', async () => {
    mockExec((_cmd, cb) => cb(null, 'node 123 kelson 21u IPv6 TCP LISTEN', ''));
    await expect(isPortBound(3000)).resolves.toBe(true);
  });

  it('returns false when lsof exits non-zero (no match)', async () => {
    mockExec((_cmd, cb) => {
      const err = new Error('exit 1') as Error & { code?: number };
      err.code = 1;
      cb(err, '', '');
    });
    await expect(isPortBound(9999)).resolves.toBe(false);
  });

  it('returns false when stdout is empty even without error', async () => {
    mockExec((_cmd, cb) => cb(null, '', ''));
    await expect(isPortBound(3000)).resolves.toBe(false);
  });

  it('rejects invalid ports without shelling out', async () => {
    await expect(isPortBound(0)).resolves.toBe(false);
    await expect(isPortBound(70000)).resolves.toBe(false);
    await expect(isPortBound(-1)).resolves.toBe(false);
    await expect(isPortBound(1.5)).resolves.toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });

  it('includes the port in the lsof command', async () => {
    mockExec((_cmd, cb) => cb(null, '', ''));
    await isPortBound(5173);
    expect(vi.mocked(exec).mock.calls[0]?.[0]).toContain(':5173');
  });
});

describe('detectBoundPort', () => {
  beforeEach(() => {
    vi.mocked(exec).mockReset();
  });

  it('returns the first bound port from candidates', async () => {
    mockExec((cmd, cb) => {
      if (cmd.includes(':3001')) {
        cb(null, 'LISTEN line', '');
      } else {
        const err = new Error('exit 1');
        cb(err, '', '');
      }
    });
    await expect(detectBoundPort([3000, 3001, 3002])).resolves.toBe(3001);
  });

  it('returns null when no candidate is bound', async () => {
    mockExec((_cmd, cb) => cb(new Error('exit 1'), '', ''));
    await expect(detectBoundPort([3000, 3001])).resolves.toBeNull();
  });

  it('returns null for an empty candidate list', async () => {
    await expect(detectBoundPort([])).resolves.toBeNull();
    expect(exec).not.toHaveBeenCalled();
  });

  it('stops probing after the first match', async () => {
    let callCount = 0;
    mockExec((_cmd, cb) => {
      callCount++;
      cb(null, 'LISTEN line', '');
    });
    await detectBoundPort([3000, 3001, 3002]);
    expect(callCount).toBe(1);
  });
});
