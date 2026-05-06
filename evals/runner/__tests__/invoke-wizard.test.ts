/**
 * Runner-side tests for `runLive` + `resolveWizardSpawn`.
 *
 * Spawn is mocked via `vi.mock('node:child_process')` so we can
 * exercise the runner's arg construction and working-dir minting
 * without actually launching `pnpm` — slow, brittle, and pointless
 * for an arg-shape assertion. The pure helper `resolveWizardSpawn`
 * is unit-tested directly.
 *
 * Regression classes covered:
 *   - per-run working dir lands under `os.tmpdir()`, not the
 *     scenario dir (so parallel runs don't collide)
 *   - `useDetection: false` drops `--integration` from the spawn args
 *   - `WIZARD_BIN` / `--wizard-bin` parameterizes the wizard binary
 *     for Ring 3 packaging coverage; option beats env
 */

import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resolveWizardSpawn,
  runLive,
  type InvokeWizardOptions,
} from '../invoke-wizard.js';
import type { Scenario } from '../scenario-schema.js';

const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

/**
 * Build a fake child process whose stdout emits a minimal but valid
 * NDJSON stream (a `run.completed` event so the runner doesn't trip
 * on parse errors), then exits cleanly. We don't need to exercise the
 * full wizard wire format here — `parseStream` has its own tests.
 */
function fakeChild(stdout: string, exitCode: number) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { setEncoding: (e: string) => void };
    stderr: EventEmitter & { setEncoding: (e: string) => void };
    kill: (sig: string) => void;
  };
  child.stdout = Object.assign(new EventEmitter(), {
    setEncoding: () => {},
  });
  child.stderr = Object.assign(new EventEmitter(), {
    setEncoding: () => {},
  });
  child.kill = () => {};
  setImmediate(() => {
    child.stdout.emit('data', stdout);
    child.emit('exit', exitCode);
  });
  return child;
}

const SCENARIO: Scenario = {
  name: 'test/vanilla',
  ring: 1,
  integrationHint: 'nextjs',
  buildCommand: ['pnpm', 'build'],
  expectedEnvPrefix: 'NEXT_PUBLIC_',
  expectedInitFile: 'src/app/AmplitudeProvider.tsx',
  expectedEvents: [],
  forbiddenPaths: [],
  useDetection: true,
};

const NDJSON_OK =
  JSON.stringify({
    schema_version: '1',
    event: 'run.completed',
    occurred_at: new Date().toISOString(),
    data_version: 1,
    data: { outcome: 'success' },
  }) + '\n';

let scenarioRoot: string;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  spawnMock.mockReset();
  // Build a minimal scenario fixture so runLive doesn't trip on the
  // "pristine missing" guard.
  scenarioRoot = mkdtempSync(join(tmpdir(), 'evals-runner-test-'));
  mkdirSync(join(scenarioRoot, 'pristine'), { recursive: true });
  writeFileSync(join(scenarioRoot, 'pristine', 'package.json'), '{}');
  // Snapshot env vars the runner reads so we don't leak across tests.
  savedEnv = {
    WIZARD_BIN: process.env.WIZARD_BIN,
    WIZARD_OAUTH_TOKEN: process.env.WIZARD_OAUTH_TOKEN,
    EVALS_ALLOW_API_KEY_BYPASS: process.env.EVALS_ALLOW_API_KEY_BYPASS,
  };
  // Force the api-key-bypass auth path so tests don't need an OAuth
  // token. The path under test is arg construction, not auth.
  delete process.env.WIZARD_OAUTH_TOKEN;
  delete process.env.WIZARD_BIN;
  process.env.EVALS_ALLOW_API_KEY_BYPASS = '1';
});

afterEach(() => {
  rmSync(scenarioRoot, { recursive: true, force: true });
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function runOptions(overrides: Partial<InvokeWizardOptions> = {}) {
  return {
    scenario: SCENARIO,
    scenarioDir: scenarioRoot,
    repoRoot: '/repo-root-stub',
    apiKey: 'fake-key',
    ...overrides,
  };
}

describe('runLive — working dir + arg construction', () => {
  it('writes its working dir under os.tmpdir() (not the scenario dir)', async () => {
    spawnMock.mockReturnValue(fakeChild(NDJSON_OK, 0));
    const { workingDir } = await runLive(runOptions());

    // Per-run subdir lives under the OS tempdir so parallel scenario
    // runs don't collide on `<scenarioDir>/working/`.
    expect(workingDir.startsWith(tmpdir())).toBe(true);
    expect(workingDir).not.toContain(scenarioRoot);
  });

  it('default: spawns pnpm exec tsx bin.ts with --integration', async () => {
    spawnMock.mockReturnValue(fakeChild(NDJSON_OK, 0));
    await runLive(runOptions());

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawnMock.mock.calls[0];
    expect(cmd).toBe('pnpm');
    expect(args.slice(0, 5)).toEqual([
      'exec',
      'tsx',
      'bin.ts',
      '--agent',
      '--yes',
    ]);
    expect(args).toContain('--integration');
    expect(args[args.indexOf('--integration') + 1]).toBe('nextjs');
  });

  it('useDetection=false: drops --integration so the wizard auto-detects', async () => {
    spawnMock.mockReturnValue(fakeChild(NDJSON_OK, 0));
    await runLive(
      runOptions({ scenario: { ...SCENARIO, useDetection: false } }),
    );

    const [, args] = spawnMock.mock.calls[0];
    expect(args).not.toContain('--integration');
    // Sanity: integrationHint is not snuck in as a positional either.
    expect(args).not.toContain('nextjs');
  });

  // Regression: the runner used to `rmSync(workingDir)` before
  // returning, which left scorers (which read files from
  // `process.env.EVALS_WORKING_DIR`) grading against a deleted tree.
  // The contract is now: runLive leaves `workingDir` populated;
  // `cleanup()` tears it down on the orchestrator's schedule.
  it('leaves workingDir populated on return; cleanup() removes it', async () => {
    spawnMock.mockReturnValue(fakeChild(NDJSON_OK, 0));
    const { workingDir, cleanup } = await runLive(runOptions());

    // Tree must be readable so Layer 0 scorers can grade against it
    // (`package.json` lookup, init-file scan, etc.).
    expect(existsSync(workingDir)).toBe(true);
    expect(existsSync(join(workingDir, 'package.json'))).toBe(true);
    expect(readFileSync(join(workingDir, 'package.json'), 'utf8')).toBe('{}');

    // Cleanup is the orchestrator's responsibility. Idempotent.
    cleanup();
    expect(existsSync(workingDir)).toBe(false);
    expect(() => cleanup()).not.toThrow();
  });

  it('replay: cleanup is a no-op (golden working dir is a fixture)', async () => {
    // Build a minimal golden fixture so runReplay loads.
    const goldenDir = join(scenarioRoot, 'golden');
    const goldenWorking = join(goldenDir, 'working');
    mkdirSync(goldenWorking, { recursive: true });
    writeFileSync(join(goldenDir, 'run.ndjson'), NDJSON_OK);
    writeFileSync(join(goldenDir, 'exit-code.txt'), '0');
    writeFileSync(join(goldenWorking, 'package.json'), '{}');

    const { runReplay } = await import('../invoke-wizard.js');
    const { workingDir, cleanup } = runReplay({
      scenario: SCENARIO,
      scenarioDir: scenarioRoot,
    });

    expect(workingDir).toBe(goldenWorking);
    cleanup();
    // Golden tree must survive cleanup — deleting it would corrupt
    // the scenario for the next run.
    expect(existsSync(goldenWorking)).toBe(true);
    expect(existsSync(join(goldenWorking, 'package.json'))).toBe(true);
  });

  it('wizardBin override: spawns the override directly without pnpm exec tsx', async () => {
    spawnMock.mockReturnValue(fakeChild(NDJSON_OK, 0));
    await runLive(runOptions({ wizardBin: 'npx @amplitude/wizard@latest' }));

    const [cmd, args] = spawnMock.mock.calls[0];
    expect(cmd).toBe('npx');
    // First arg is the package spec the override carried, NOT
    // `exec`/`tsx`/`bin.ts` from the default shape.
    expect(args[0]).toBe('@amplitude/wizard@latest');
    expect(args).not.toContain('tsx');
    expect(args).not.toContain('bin.ts');
    // Framework invariants still appended.
    expect(args).toContain('--agent');
    expect(args).toContain('--yes');
    expect(args).toContain('--install-dir');
  });
});

describe('resolveWizardSpawn', () => {
  it('defaults to pnpm exec tsx bin.ts when no override is set', () => {
    delete process.env.WIZARD_BIN;
    const { cmd, baseArgs } = resolveWizardSpawn(runOptions());
    expect(cmd).toBe('pnpm');
    expect(baseArgs).toEqual(['exec', 'tsx', 'bin.ts']);
  });

  it('honors options.wizardBin and tokenizes the command on whitespace', () => {
    const { cmd, baseArgs } = resolveWizardSpawn(
      runOptions({ wizardBin: 'npx @amplitude/wizard@latest' }),
    );
    expect(cmd).toBe('npx');
    expect(baseArgs).toEqual(['@amplitude/wizard@latest']);
  });

  it('honors WIZARD_BIN env when no option is set', () => {
    process.env.WIZARD_BIN = '/path/to/built-cli';
    const { cmd, baseArgs } = resolveWizardSpawn(runOptions());
    expect(cmd).toBe('/path/to/built-cli');
    expect(baseArgs).toEqual([]);
  });

  it('option wins when both option and env are set', () => {
    process.env.WIZARD_BIN = 'env-binary';
    const { cmd } = resolveWizardSpawn(
      runOptions({ wizardBin: 'option-binary' }),
    );
    expect(cmd).toBe('option-binary');
  });

  it('falls back to default when override is whitespace-only', () => {
    const { cmd, baseArgs } = resolveWizardSpawn(
      runOptions({ wizardBin: '   ' }),
    );
    expect(cmd).toBe('pnpm');
    expect(baseArgs).toEqual(['exec', 'tsx', 'bin.ts']);
  });
});
