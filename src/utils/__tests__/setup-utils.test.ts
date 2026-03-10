import { installPackage } from '../setup-utils';

import * as ChildProcess from 'node:child_process';
import type { PackageManager } from '../package-manager';

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
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

describe.skip('installPackage', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('force-installs a package if the forceInstall flag is set', async () => {
    const packageManagerMock: PackageManager = {
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

    const execSpy = jest
      .spyOn(ChildProcess, 'exec')
      // @ts-expect-error - don't care about the return value
      .mockImplementationOnce((cmd, cb) => {
        if (cb) {
          // @ts-expect-error - don't care about the options value
          cb(null, '', '');
        }
      });

    await installPackage({
      alreadyInstalled: false,
      packageName: 'amplitude-js',
      packageNameDisplayLabel: 'amplitude-js',
      forceInstall: true,
      packageManager: packageManagerMock,
      installDir: process.cwd(),
    });

    expect(execSpy).toHaveBeenCalledWith(
      'npm install amplitude-js  --force',
      expect.any(Function),
    );
  });

  it.each([false, undefined])(
    "doesn't force-install a package if the forceInstall flag is %s",
    async (flag) => {
      const packageManagerMock: PackageManager = {
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

      const execSpy = jest
        .spyOn(ChildProcess, 'exec')
        // @ts-expect-error - don't care about the return value
        .mockImplementationOnce((cmd, cb) => {
          if (cb) {
            // @ts-expect-error - don't care about the options value
            cb(null, '', '');
          }
        });

      await installPackage({
        alreadyInstalled: false,
        packageName: 'amplitude-js',
        packageNameDisplayLabel: 'amplitude-js',
        forceInstall: flag,
        packageManager: packageManagerMock,
        installDir: process.cwd(),
      });

      expect(execSpy).toHaveBeenCalledWith(
        'npm install amplitude-js  ',
        expect.any(Function),
      );
    },
  );
});
