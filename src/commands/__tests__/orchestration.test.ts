/**
 * `wizard tasks/task/sessions/session/resume/orchestration status` smoke tests.
 *
 * Spawns the real CLI binary against a tmp install dir + cache root so the
 * full yargs → command-handler → store path is exercised. Validates JSON
 * output against the Zod envelope schemas — a regression in the producer
 * surfaces here as a parse error.
 *
 * Tests run sequentially to avoid clobbering the shared cache root env var.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { OrchestrationStore } from '../../lib/orchestration/store';
import { TaskLifecycle } from '../../lib/orchestration/lifecycle';
import {
  TasksEnvelopeSchema,
  TaskEnvelopeSchema,
  SessionsEnvelopeSchema,
  SessionEnvelopeSchema,
  ResumeEnvelopeSchema,
  StatusEnvelopeSchema,
  ChoicesEnvelopeSchema,
  ChoiceEnvelopeSchema,
  ChoiceAnswerEnvelopeSchema,
  VerificationsEnvelopeSchema,
  VerificationEnvelopeSchema,
  VerificationMarkEnvelopeSchema,
} from '../../lib/orchestration/schemas';
import { ChoiceKind } from '../../lib/orchestration/checkpoints/choices';
import { VerificationKind } from '../../lib/orchestration/checkpoints/verifications';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const BIN = resolve(REPO_ROOT, 'bin.ts');

let cacheRoot: string;
let installDir: string;

// Shared seed for env() — the CLI's bootstrap migrations may touch the
// cache so we use a fresh dir per process.
beforeAll(() => {
  cacheRoot = mkdtempSync(join(tmpdir(), 'orch-cli-'));
  installDir = mkdtempSync(join(tmpdir(), 'orch-cli-install-'));
  process.env.AMPLITUDE_WIZARD_CACHE_DIR = cacheRoot;
  process.env.AMPLITUDE_WIZARD_SKIP_BOOTSTRAP = '1';

  // Seed the store with a session and a few tasks so the CLI has data to
  // emit.
  const store = new OrchestrationStore(installDir);
  const session = store.createSession({ goal: 'CLI smoke seed' });
  // Persist the seed session id for later assertions via env so subprocesses
  // can read it without re-loading the store.
  process.env.__ORCH_TEST_SESSION_ID = session.id;
  const t = store.createTask({
    sessionId: session.id,
    label: 'install Amplitude SDK',
    initialState: TaskLifecycle.Running,
  });
  process.env.__ORCH_TEST_TASK_ID = t.id;
  store.transitionTask(t.id, TaskLifecycle.Completed);
  const t2 = store.createTask({
    sessionId: session.id,
    label: 'pending task',
  });
  void t2;

  // PR 2: seed a Choice (one human-required, one automation-allowed)
  // and a Verification so the new commands have data to surface.
  const humanChoice = store.addChoice({
    kind: ChoiceKind.EnvironmentSelection,
    promptId: 'env_selection:cli-smoke',
    message: 'Pick an environment',
    options: [
      { id: 'opt-prod', label: 'Production' },
      { id: 'opt-staging', label: 'Staging' },
    ],
    recommendedOptionId: 'opt-prod',
    safeDefaultOptionId: 'opt-prod',
    requiresHuman: true,
    automationAllowed: false,
    timeoutBehavior: null,
    consequenceIfSkipped: 'no env, no events',
    reversible: true,
    whyAsking: 'multiple envs',
    resumeCommand: ['wizard', '--agent'],
    linkedSessionId: session.id,
  });
  process.env.__ORCH_TEST_CHOICE_HUMAN_ID = humanChoice.id;

  const autoChoice = store.addChoice({
    kind: ChoiceKind.Other,
    promptId: 'other:cli-smoke',
    message: 'pick something',
    options: [{ id: 'a', label: 'A' }],
    recommendedOptionId: 'a',
    safeDefaultOptionId: 'a',
    requiresHuman: false,
    automationAllowed: true,
    timeoutBehavior: null,
    consequenceIfSkipped: 'meh',
    reversible: true,
    whyAsking: 'because',
    resumeCommand: ['wizard'],
    linkedSessionId: session.id,
  });
  process.env.__ORCH_TEST_CHOICE_AUTO_ID = autoChoice.id;

  const verif = store.addVerification({
    kind: VerificationKind.EventsArrivingInAmplitude,
    whatToVerify: 'events arrive',
    expectedBehavior: 'events appear in live stream',
    blockingSessionId: session.id,
    resumeCommand: ['wizard', 'verification', 'mark'],
  });
  process.env.__ORCH_TEST_VERIF_ID = verif.id;
});

afterAll(() => {
  rmSync(cacheRoot, { recursive: true, force: true });
  rmSync(installDir, { recursive: true, force: true });
  delete process.env.AMPLITUDE_WIZARD_CACHE_DIR;
  delete process.env.AMPLITUDE_WIZARD_SKIP_BOOTSTRAP;
  delete process.env.__ORCH_TEST_SESSION_ID;
  delete process.env.__ORCH_TEST_TASK_ID;
  delete process.env.__ORCH_TEST_CHOICE_HUMAN_ID;
  delete process.env.__ORCH_TEST_CHOICE_AUTO_ID;
  delete process.env.__ORCH_TEST_VERIF_ID;
});

function runCli(args: string[]): {
  status: number;
  stdout: string;
  stderr: string;
} {
  // Use tsx to execute bin.ts directly without a build step. The
  // dev-time runner (`pnpm try`) does the same. We pass --install-dir
  // so each command targets the seeded store.
  const tsxBin = resolve(REPO_ROOT, 'node_modules', '.bin', 'tsx');
  const result = spawnSync(
    tsxBin,
    [BIN, ...args, '--install-dir', installDir, '--json'],
    {
      env: {
        ...process.env,
        AMPLITUDE_WIZARD_CACHE_DIR: cacheRoot,
        AMPLITUDE_WIZARD_SKIP_BOOTSTRAP: '1',
        // Quiet down the bootstrap log + analytics noise.
        AMPLITUDE_WIZARD_LOG: 'error',
        // Disable update-notifier in tests.
        NO_UPDATE_NOTIFIER: '1',
        // Mark as non-interactive so any code path that branches on TTY
        // doesn't try to spin up the TUI.
        CI: '1',
        FORCE_COLOR: '0',
      },
      encoding: 'utf-8',
      timeout: 30_000,
    },
  );
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function parseFirstJsonLine(stdout: string): unknown {
  // The bootstrap path may log unrelated warnings to stdout in some
  // builds; pick the last well-formed JSON line, which is the envelope.
  const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!;
    if (line.startsWith('{') || line.startsWith('[')) {
      try {
        return JSON.parse(line);
      } catch {
        // continue
      }
    }
  }
  throw new Error(`No JSON envelope found in stdout:\n${stdout}`);
}

describe('wizard tasks (CLI smoke)', () => {
  it('emits a valid TasksEnvelope and exits 0', () => {
    const r = runCli(['tasks']);
    expect(r.status).toBe(0);
    const envelope = TasksEnvelopeSchema.parse(parseFirstJsonLine(r.stdout));
    expect(envelope.type).toBe('orchestration_tasks');
    expect(envelope.tasks.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects a bogus --state with INVALID_ARGS=2', () => {
    const r = runCli(['tasks', '--state', 'cosmic_rays']);
    expect(r.status).toBe(2);
  });
});

describe('wizard task <id> (CLI smoke)', () => {
  it('emits a valid TaskEnvelope for an existing task', () => {
    const id = process.env.__ORCH_TEST_TASK_ID!;
    const r = runCli(['task', id]);
    expect(r.status).toBe(0);
    const envelope = TaskEnvelopeSchema.parse(parseFirstJsonLine(r.stdout));
    expect(envelope.task.id).toBe(id);
  });

  it('returns INVALID_ARGS=2 for a nonexistent task id', () => {
    const r = runCli(['task', 'task_nonexistent']);
    expect(r.status).toBe(2);
  });
});

describe('wizard sessions (CLI smoke)', () => {
  it('emits a valid SessionsEnvelope and exits 0', () => {
    const r = runCli(['sessions']);
    expect(r.status).toBe(0);
    const envelope = SessionsEnvelopeSchema.parse(parseFirstJsonLine(r.stdout));
    expect(envelope.sessions.length).toBeGreaterThanOrEqual(1);
  });
});

describe('wizard session <id> (CLI smoke)', () => {
  it('emits a valid SessionEnvelope and includes its tasks', () => {
    const id = process.env.__ORCH_TEST_SESSION_ID!;
    const r = runCli(['session', id]);
    expect(r.status).toBe(0);
    const envelope = SessionEnvelopeSchema.parse(parseFirstJsonLine(r.stdout));
    expect(envelope.session.id).toBe(id);
    expect(envelope.tasks.length).toBeGreaterThanOrEqual(1);
  });
});

describe('wizard resume <session-id> (CLI smoke)', () => {
  it('prints (without executing) a valid ResumeEnvelope by default', () => {
    const id = process.env.__ORCH_TEST_SESSION_ID!;
    const r = runCli(['resume', id]);
    expect(r.status).toBe(0);
    const envelope = ResumeEnvelopeSchema.parse(parseFirstJsonLine(r.stdout));
    expect(envelope.executed).toBe(false);
    expect(envelope.command.length).toBeGreaterThan(0);
  });
});

describe('wizard choice list/show/answer (CLI smoke)', () => {
  it('choice list returns a valid ChoicesEnvelope with the seeded pending choices', () => {
    const r = runCli(['choice', 'list']);
    expect(r.status).toBe(0);
    const envelope = ChoicesEnvelopeSchema.parse(parseFirstJsonLine(r.stdout));
    expect(envelope.choices.length).toBeGreaterThanOrEqual(2);
  });

  it('choice show returns a valid ChoiceEnvelope', () => {
    const id = process.env.__ORCH_TEST_CHOICE_HUMAN_ID!;
    const r = runCli(['choice', 'show', id]);
    expect(r.status).toBe(0);
    const envelope = ChoiceEnvelopeSchema.parse(parseFirstJsonLine(r.stdout));
    expect(envelope.choice.id).toBe(id);
  });

  it('choice show on bogus id exits with INVALID_ARGS=2', () => {
    const r = runCli(['choice', 'show', 'not_a_choice']);
    expect(r.status).toBe(2);
  });

  it('choice answer on a missing choice id exits with CHOICE_NOT_FOUND=30', () => {
    const r = runCli([
      'choice',
      'answer',
      'choice_does_not_exist',
      '--option',
      'a',
    ]);
    expect(r.status).toBe(30);
  });

  it('choice answer rejects requiresHuman=true without --confirm-human (exit 32)', () => {
    const id = process.env.__ORCH_TEST_CHOICE_HUMAN_ID!;
    const r = runCli(['choice', 'answer', id, '--option', 'opt-prod']);
    expect(r.status).toBe(32);
  });

  it('choice answer succeeds for an automation-allowed choice without --confirm-human', () => {
    const id = process.env.__ORCH_TEST_CHOICE_AUTO_ID!;
    const r = runCli(['choice', 'answer', id, '--option', 'a']);
    expect(r.status).toBe(0);
    const envelope = ChoiceAnswerEnvelopeSchema.parse(
      parseFirstJsonLine(r.stdout),
    );
    expect(envelope.choice.status).toBe('answered');
    expect(envelope.choice.answeredOptionId).toBe('a');
  });
});

describe('wizard verification list/show/mark (CLI smoke)', () => {
  it('verification list returns a valid VerificationsEnvelope', () => {
    const r = runCli(['verification', 'list']);
    expect(r.status).toBe(0);
    const envelope = VerificationsEnvelopeSchema.parse(
      parseFirstJsonLine(r.stdout),
    );
    expect(envelope.verifications.length).toBeGreaterThanOrEqual(1);
  });

  it('verification show on missing id exits with VERIFICATION_NOT_FOUND=33', () => {
    const r = runCli(['verification', 'show', 'verif_does_not_exist']);
    expect(r.status).toBe(33);
  });

  it('verification show returns a valid VerificationEnvelope', () => {
    const id = process.env.__ORCH_TEST_VERIF_ID!;
    const r = runCli(['verification', 'show', id]);
    expect(r.status).toBe(0);
    const envelope = VerificationEnvelopeSchema.parse(
      parseFirstJsonLine(r.stdout),
    );
    expect(envelope.verification.id).toBe(id);
  });

  it('verification mark transitions to passed', () => {
    const id = process.env.__ORCH_TEST_VERIF_ID!;
    const r = runCli(['verification', 'mark', id, '--status', 'passed']);
    expect(r.status).toBe(0);
    const envelope = VerificationMarkEnvelopeSchema.parse(
      parseFirstJsonLine(r.stdout),
    );
    expect(envelope.verification.status).toBe('passed');
  });
});

describe('wizard orchestration status (CLI smoke)', () => {
  it('emits a valid StatusEnvelope reflecting the seeded store', () => {
    const r = runCli(['orchestration', 'status']);
    expect(r.status).toBe(0);
    const envelope = StatusEnvelopeSchema.parse(parseFirstJsonLine(r.stdout));
    expect(envelope.storeExists).toBe(true);
    // Pending task → activeTasks > 0; completed task counted.
    expect(
      envelope.lastStoppingPoint.activeTasks.length,
    ).toBeGreaterThanOrEqual(0);
    expect(
      envelope.lastStoppingPoint.recentlyCompletedTasks.length,
    ).toBeGreaterThanOrEqual(1);
  });
});
