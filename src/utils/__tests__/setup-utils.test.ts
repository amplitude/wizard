import { vi, describe, it, expect, afterEach, beforeEach } from 'vitest';
import { installPackage } from '../setup-utils';

import * as ChildProcess from 'node:child_process';
import type { PackageManager } from '../package-manager';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>(
    'node:child_process',
  );
  return { __esModule: true, ...actual };
});

vi.mock('../../ui', () => ({
  getUI: vi.fn().mockReturnValue({
    log: {
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      step: vi.fn(),
    },
    cancel: vi.fn(),
    outro: vi.fn(),
    intro: vi.fn(),
    spinner: vi.fn().mockImplementation(() => ({
      start: vi.fn(),
      stop: vi.fn(),
      message: vi.fn(),
    })),
    setDetectedFramework: vi.fn(),
    setCredentials: vi.fn(),
    pushStatus: vi.fn(),
    syncTodos: vi.fn(),
    setLoginUrl: vi.fn(),
    showServiceStatus: vi.fn(),
    showSettingsOverride: vi.fn(),
    startRun: vi.fn(),
    note: vi.fn(),
  }),
}));

const npmManager: PackageManager = {
  name: 'npm',
  label: 'NPM',
  installCommand: 'npm install',
  buildCommand: 'npm run build',
  runScriptCommand: 'npm run',
  flags: '',
  forceInstallFlag: '--force',
  detect: vi.fn(),
  addOverride: vi.fn(),
};

describe('installPackage', () => {
  let tmpDir: string;

  beforeEach(() => {
    // Use an empty tmpdir so isReact19Installed short-circuits (no
    // package.json in the install dir) — keeps tests independent of the
    // wizard repo's own React 19 dev-dep.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-package-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('force-installs a package if the forceInstall flag is set', async () => {
    const execFileSpy = vi
      .spyOn(ChildProcess, 'execFile')
      // @ts-expect-error - don't care about the return value
      .mockImplementationOnce((file, args, options, cb) => {
        if (typeof cb === 'function') {
          cb(null, '', '');
        }
      });

    await installPackage({
      alreadyInstalled: false,
      packageName: 'amplitude-js',
      packageNameDisplayLabel: 'amplitude-js',
      forceInstall: true,
      packageManager: npmManager,
      installDir: tmpDir,
    });

    expect(execFileSpy).toHaveBeenCalledWith(
      'npm',
      ['install', 'amplitude-js', '--force'],
      expect.objectContaining({ cwd: tmpDir }),
      expect.any(Function),
    );
  });

  it.each([false, undefined])(
    "doesn't force-install a package if the forceInstall flag is %s",
    async (flag) => {
      const execFileSpy = vi
        .spyOn(ChildProcess, 'execFile')
        // @ts-expect-error - don't care about the return value
        .mockImplementationOnce((file, args, options, cb) => {
          if (typeof cb === 'function') {
            cb(null, '', '');
          }
        });

      await installPackage({
        alreadyInstalled: false,
        packageName: 'amplitude-js',
        packageNameDisplayLabel: 'amplitude-js',
        forceInstall: flag,
        packageManager: npmManager,
        installDir: tmpDir,
      });

      expect(execFileSpy).toHaveBeenCalledWith(
        'npm',
        ['install', 'amplitude-js'],
        expect.objectContaining({ cwd: tmpDir }),
        expect.any(Function),
      );
    },
  );

  // Regression: prior to the F2 shell-injection fix, installPackage built a
  // shell string from `installCommand` + `packageName` + `flags`. A
  // (hypothetical) malicious package name like `; touch /tmp/pwned #` would
  // have been interpolated into a shell pipe. With execFile, every token is
  // a separate argv entry — shell metacharacters are inert.
  it('passes shell metacharacters in package name as a single argv entry', async () => {
    const execFileSpy = vi
      .spyOn(ChildProcess, 'execFile')
      // @ts-expect-error - don't care about the return value
      .mockImplementationOnce((file, args, options, cb) => {
        if (typeof cb === 'function') {
          cb(null, '', '');
        }
      });

    await installPackage({
      alreadyInstalled: false,
      packageName: '; touch /tmp/pwned #',
      forceInstall: false,
      packageManager: npmManager,
      installDir: tmpDir,
    });

    const callArgs = execFileSpy.mock.calls[0];
    expect(callArgs[0]).toBe('npm');
    // The "malicious" package name is preserved as a single argv element,
    // not split or interpreted by a shell.
    expect(callArgs[1]).toContain('; touch /tmp/pwned #');
  });
});
