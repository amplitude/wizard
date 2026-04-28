import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  collectDiagnostics,
  DiagnosticsSchema,
  DIAGNOSTICS_SCHEMA_VERSION,
  redactHomePath,
} from '../diagnostics-collector';
import type { WizardSession } from '../wizard-session';
import { RunPhase } from '../wizard-session';

vi.mock('../../utils/debug');
vi.mock('../../utils/analytics', () => ({
  analytics: {
    setTag: vi.fn(),
    setSessionProperty: vi.fn(),
    wizardCapture: vi.fn(),
  },
}));

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'diag-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function baseSession(
  installDir: string,
): Pick<
  WizardSession,
  | 'installDir'
  | 'integration'
  | 'region'
  | 'runPhase'
  | 'introConcluded'
  | 'setupConfirmed'
  | 'detectionComplete'
  | 'credentials'
> {
  return {
    installDir,
    integration: null,
    region: 'us',
    runPhase: RunPhase.Idle,
    introConcluded: false,
    setupConfirmed: false,
    detectionComplete: false,
    credentials: null,
  };
}

describe('redactHomePath', () => {
  it('replaces $HOME with ~', () => {
    const home = os.homedir();
    expect(redactHomePath(`${home}/project/file.ts`)).toBe('~/project/file.ts');
  });

  it('replaces /Users/<name> even when homedir does not match', () => {
    expect(redactHomePath('/Users/alice/code/thing')).toBe(
      '/Users/~/code/thing',
    );
  });

  it('replaces /home/<name> on linux-style paths', () => {
    expect(redactHomePath('/home/bob/project/file')).toBe(
      '/home/~/project/file',
    );
  });

  it('leaves non-home paths untouched', () => {
    expect(redactHomePath('/usr/local/bin/node')).toBe('/usr/local/bin/node');
  });
});

describe('collectDiagnostics', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('returns a schema-valid payload when the directory is empty', async () => {
    const diag = await collectDiagnostics({
      session: baseSession(tmpDir),
      wizardVersion: '1.2.3',
    });

    expect(() => DiagnosticsSchema.parse(diag)).not.toThrow();
    expect(diag.schema_version).toBe(DIAGNOSTICS_SCHEMA_VERSION);
    expect(diag.system.wizard_version).toBe('1.2.3');
    expect(diag.codebase.has_package_json).toBe(false);
    expect(diag.codebase.has_typescript).toBe(false);
    expect(diag.codebase.amplitude_sdk_packages).toEqual([]);
    expect(diag.codebase.dependency_counts).toEqual({
      dependencies: 0,
      dev_dependencies: 0,
    });
    expect(diag.codebase.monorepo).toBe(false);
  });

  it('detects amplitude SDK packages from package.json', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        dependencies: {
          '@amplitude/analytics-browser': '^2.0.0',
          '@amplitude/unified': '^1.0.0',
          react: '^18.0.0',
        },
        devDependencies: {
          typescript: '^5.0.0',
        },
      }),
    );

    const diag = await collectDiagnostics({
      session: baseSession(tmpDir),
      wizardVersion: '1.0.0',
    });

    expect(diag.codebase.has_package_json).toBe(true);
    expect(diag.codebase.has_typescript).toBe(true);
    expect(diag.codebase.amplitude_sdk_packages).toEqual([
      { name: '@amplitude/analytics-browser', version: '^2.0.0' },
      { name: '@amplitude/unified', version: '^1.0.0' },
    ]);
    expect(diag.codebase.dependency_counts).toEqual({
      dependencies: 3,
      dev_dependencies: 1,
    });
  });

  it('detects TypeScript via tsconfig.json even without the dep', async () => {
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');

    const diag = await collectDiagnostics({
      session: baseSession(tmpDir),
      wizardVersion: '1.0.0',
    });

    expect(diag.codebase.has_typescript).toBe(true);
  });

  it('detects monorepo via pnpm-workspace.yaml', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pnpm-workspace.yaml'),
      'packages:\n  - "apps/*"',
    );

    const diag = await collectDiagnostics({
      session: baseSession(tmpDir),
      wizardVersion: '1.0.0',
    });

    expect(diag.codebase.monorepo).toBe(true);
  });

  it('detects monorepo via package.json workspaces field', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ workspaces: ['packages/*'] }),
    );

    const diag = await collectDiagnostics({
      session: baseSession(tmpDir),
      wizardVersion: '1.0.0',
    });

    expect(diag.codebase.monorepo).toBe(true);
  });

  it('includes only detected frameworks in the payload', async () => {
    const diag = await collectDiagnostics({
      session: baseSession(tmpDir),
      wizardVersion: '1.0.0',
      detectedFrameworks: [
        { integration: 'nextjs', detected: true },
        { integration: 'vue', detected: false },
        { integration: 'react-router', detected: true },
      ],
    });

    expect(diag.codebase.detected_frameworks).toEqual([
      'nextjs',
      'react-router',
    ]);
  });

  it('never leaks absolute paths in collection_errors', async () => {
    // Corrupt package.json so readProjectJson catches a parse error; the
    // error message should be redacted if it contains the project path.
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{ not valid json');

    const diag = await collectDiagnostics({
      session: baseSession(tmpDir),
      wizardVersion: '1.0.0',
      // Force an error path by passing a very tight timeout — also exercises
      // the timeout branch of the collector.
      timeoutMs: 5,
    });

    // The JSON parse failures are swallowed by readProjectJson (returns null),
    // so the collector still produces a clean payload.
    expect(diag.codebase.has_package_json).toBe(true);
    expect(diag.codebase.amplitude_sdk_packages).toEqual([]);
    // Any error messages that do get recorded must not contain the home dir.
    const home = os.homedir();
    for (const err of diag.collection_errors) {
      expect(err).not.toContain(home);
    }
  });

  it('falls back to defaults when the installDir does not exist', async () => {
    const nonExistent = path.join(tmpDir, 'does', 'not', 'exist');

    const diag = await collectDiagnostics({
      session: baseSession(nonExistent),
      wizardVersion: '1.0.0',
    });

    expect(() => DiagnosticsSchema.parse(diag)).not.toThrow();
    expect(diag.codebase.has_package_json).toBe(false);
    expect(diag.codebase.monorepo).toBe(false);
  });

  it('propagates session fields verbatim', async () => {
    const session = baseSession(tmpDir);
    session.integration = 'nextjs';
    session.runPhase = RunPhase.Running;
    session.introConcluded = true;
    session.setupConfirmed = true;
    session.detectionComplete = true;

    const diag = await collectDiagnostics({
      session,
      wizardVersion: '1.0.0',
    });

    expect(diag.session.integration).toBe('nextjs');
    expect(diag.session.run_phase).toBe(RunPhase.Running);
    expect(diag.session.intro_concluded).toBe(true);
    expect(diag.session.setup_confirmed).toBe(true);
    expect(diag.session.detection_complete).toBe(true);
    expect(diag.session.region).toBe('us');
  });
});
