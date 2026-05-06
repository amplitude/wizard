/**
 * Runner-side tests for `runLive`. Spawn is mocked so we can exercise
 * the runner's arg construction and working-dir minting without
 * actually launching `pnpm` — slow, brittle, and pointless for this
 * level of assertion.
 */

import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runLive, type InvokeWizardOptions } from '../invoke-wizard.js';
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
    WIZARD_OAUTH_TOKEN: process.env.WIZARD_OAUTH_TOKEN,
    EVALS_ALLOW_API_KEY_BYPASS: process.env.EVALS_ALLOW_API_KEY_BYPASS,
  };
  // Force the api-key-bypass auth path so tests don't need an OAuth
  // token. The path under test is arg construction, not auth.
  delete process.env.WIZARD_OAUTH_TOKEN;
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
});
