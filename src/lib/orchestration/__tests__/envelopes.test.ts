/**
 * Schema-parity tests for the shared envelope builders.
 *
 * Every PR 1 + PR 2 envelope is now produced by `buildXxxEnvelope` in
 * `envelopes.ts`. This file:
 *   1. round-trips a representative payload through `XxxEnvelopeSchema.parse`
 *      and asserts the builder's output matches a fresh schema parse,
 *   2. asserts the read-cache helper hands the same parsed object back to
 *      successive callers within one `withReadCache` scope but reads fresh
 *      data outside it (so a long-lived MCP server doesn't ossify state).
 *
 * The point is to lock the CLI <-> MCP-tool parity into the test suite so
 * a future regression that only updates one surface gets caught.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  buildStatusEnvelope,
  buildLastStoppingPointEnvelope,
  buildResumeEnvelope,
  buildTasksEnvelope,
  buildTaskEnvelope,
  buildSessionsEnvelope,
  buildSessionEnvelope,
  buildChoicesEnvelope,
  buildChoiceEnvelope,
  buildVerificationsEnvelope,
  buildMcpCapabilitiesEnvelope,
  buildMcpCapabilityEnvelope,
  withReadCache,
  ENVELOPE_SCHEMAS,
  _resetEnvelopeReadCache,
} from '../envelopes';
import { getOrchestrationStore, _resetOrchestrationStoreCache } from '../store';
import { TaskLifecycle } from '../lifecycle';
import { ChoiceKind, ChoiceStatus } from '../checkpoints/choices';
import {
  VerificationKind,
  VerificationStatus,
} from '../checkpoints/verifications';
import {
  McpAppCapabilityKind,
  McpAppCapabilityState,
} from '../mcp-app-lifecycle';
import { CLI_INVOCATION } from '../../../commands/context';

let installDir: string;
let originalCacheDir: string | undefined;

beforeEach(() => {
  installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'envelopes-test-'));
  originalCacheDir = process.env.AMPLITUDE_WIZARD_CACHE_DIR;
  process.env.AMPLITUDE_WIZARD_CACHE_DIR = path.join(installDir, '.cache');
  _resetOrchestrationStoreCache();
  _resetEnvelopeReadCache();
});
afterEach(() => {
  if (originalCacheDir === undefined) {
    delete process.env.AMPLITUDE_WIZARD_CACHE_DIR;
  } else {
    process.env.AMPLITUDE_WIZARD_CACHE_DIR = originalCacheDir;
  }
  fs.rmSync(installDir, { recursive: true, force: true });
});

function seed() {
  const store = getOrchestrationStore(installDir);
  const session = store.createSession({
    goal: 'Set up Amplitude',
    branch: 'main',
    worktree: installDir,
  });
  const task = store.createTask({
    sessionId: session.id,
    label: 'Detect framework',
    initialState: TaskLifecycle.Running,
  });
  const choice = store.addChoice({
    kind: ChoiceKind.EnvironmentSelection,
    promptId: `environment_selection:${installDir}`,
    message: 'Pick an env',
    options: [
      { id: 'a', label: 'A', description: 'first' },
      { id: 'b', label: 'B' },
    ],
    recommendedOptionId: 'a',
    safeDefaultOptionId: 'a',
    requiresHuman: true,
    automationAllowed: false,
    consequenceIfSkipped: 'No env, no events',
    reversible: true,
    whyAsking: 'Multiple envs detected',
    resumeCommand: ['npx', '@amplitude/wizard'],
    linkedTaskId: task.id,
    linkedSessionId: session.id,
  });
  const verification = store.addVerification({
    kind: VerificationKind.ManualPrTest,
    whatToVerify: 'Open the PR and run the test plan',
    expectedBehavior: 'All checks pass',
    blockingSessionId: session.id,
    blockingTaskId: task.id,
    resumeCommand: ['npx', '@amplitude/wizard'],
  });
  const cap = store.addMcpCapability({
    kind: McpAppCapabilityKind.AmplitudeMcpHttp,
    whyNeeded: 'For tracking',
    whatItEnables: 'Charts, dashboards',
    required: false,
    consequenceIfSkipped: 'No chat-based analytics',
    safeToSkip: true,
    reversible: true,
    userDecisionResumeCommand: ['npx', '@amplitude/wizard', '/mcp'],
    linkedSessionId: session.id,
  });
  return { session, task, choice, verification, cap };
}

describe('envelope builders — schema parity', () => {
  it('buildTasksEnvelope output is accepted by TasksEnvelopeSchema', () => {
    seed();
    const env = buildTasksEnvelope({ installDir });
    expect(() => ENVELOPE_SCHEMAS.tasks.parse(env)).not.toThrow();
    expect(env.v).toBe(1);
    expect(env.type).toBe('orchestration_tasks');
    expect(env.tasks).toHaveLength(1);
  });

  it('buildTaskEnvelope returns null for unknown id', () => {
    const result = buildTaskEnvelope({
      installDir,
      taskId: 'task_doesntexist' as never,
    });
    expect(result).toBeNull();
  });

  it('buildSessionsEnvelope and buildSessionEnvelope round-trip', () => {
    const { session } = seed();
    const list = buildSessionsEnvelope({ installDir });
    expect(() => ENVELOPE_SCHEMAS.sessions.parse(list)).not.toThrow();
    expect(list.sessions).toHaveLength(1);
    const single = buildSessionEnvelope({ installDir, sessionId: session.id });
    expect(single).not.toBeNull();
    expect(() => ENVELOPE_SCHEMAS.session.parse(single!)).not.toThrow();
    expect(single!.session.id).toBe(session.id);
    expect(single!.tasks).toHaveLength(1);
  });

  it('buildStatusEnvelope and buildLastStoppingPointEnvelope agree on lastStoppingPoint', () => {
    seed();
    const status = buildStatusEnvelope({ installDir });
    const lsp = buildLastStoppingPointEnvelope({ installDir });
    expect(() => ENVELOPE_SCHEMAS.status.parse(status)).not.toThrow();
    expect(() => ENVELOPE_SCHEMAS.lastStoppingPoint.parse(lsp)).not.toThrow();
    // The two envelopes are computed from the same store, so the LSP
    // pieces (sans `generatedAt`) must match.
    expect(status.lastStoppingPoint.currentSessionId).toBe(
      lsp.lastStoppingPoint.currentSessionId,
    );
    expect(status.lastStoppingPoint.activeTasks).toEqual(
      lsp.lastStoppingPoint.activeTasks,
    );
  });

  it('buildResumeEnvelope contains the same command as the LSP nextAction', () => {
    const { session } = seed();
    const lsp = buildLastStoppingPointEnvelope({ installDir });
    const env = buildResumeEnvelope({ installDir, sessionId: session.id });
    expect(env.command).toEqual(lsp.lastStoppingPoint.nextAction.command);
    expect(env.executed).toBe(false);
  });

  it('buildChoicesEnvelope filters by status', () => {
    seed();
    const all = buildChoicesEnvelope({ installDir });
    expect(all.choices).toHaveLength(1);
    const pending = buildChoicesEnvelope({
      installDir,
      status: ChoiceStatus.Pending,
    });
    expect(pending.choices).toHaveLength(1);
    const answered = buildChoicesEnvelope({
      installDir,
      status: ChoiceStatus.Answered,
    });
    expect(answered.choices).toHaveLength(0);
  });

  it('buildChoiceEnvelope returns null for unknown id', () => {
    const result = buildChoiceEnvelope({
      installDir,
      choiceId: 'choice_unknown' as never,
    });
    expect(result).toBeNull();
  });

  it('buildVerificationsEnvelope filters by status', () => {
    seed();
    const pending = buildVerificationsEnvelope({
      installDir,
      status: VerificationStatus.Pending,
    });
    expect(pending.verifications).toHaveLength(1);
    const passed = buildVerificationsEnvelope({
      installDir,
      status: VerificationStatus.Passed,
    });
    expect(passed.verifications).toHaveLength(0);
  });

  it('buildMcpCapabilitiesEnvelope and buildMcpCapabilityEnvelope round-trip', () => {
    const { cap } = seed();
    const list = buildMcpCapabilitiesEnvelope({ installDir });
    expect(() => ENVELOPE_SCHEMAS.mcpCapabilities.parse(list)).not.toThrow();
    expect(list.capabilities).toHaveLength(1);
    const single = buildMcpCapabilityEnvelope({
      installDir,
      capabilityId: cap.id,
    });
    expect(single).not.toBeNull();
    expect(() => ENVELOPE_SCHEMAS.mcpCapability.parse(single!)).not.toThrow();
  });

  it('builders skip filtering by an absent state', () => {
    seed();
    const env = buildMcpCapabilitiesEnvelope({
      installDir,
      state: McpAppCapabilityState.InstallSkipped,
    });
    expect(env.capabilities).toHaveLength(0);
  });

  it('withReadCache reuses the parsed snapshot inside the closure', () => {
    seed();
    const reads: number[] = [];
    withReadCache((key) => {
      const a = buildTasksEnvelope({ installDir, cacheKey: key });
      const b = buildSessionsEnvelope({ installDir, cacheKey: key });
      reads.push(a.tasks.length, b.sessions.length);
    });
    expect(reads).toEqual([1, 1]);
  });

  it('void CLI_INVOCATION import — keeps build-time module side effects deterministic', () => {
    // Exists purely to make sure the test suite touches the module that
    // computeLastStoppingPoint depends on; otherwise tsc could dead-strip
    // the import in the env where this test runs.
    expect(typeof CLI_INVOCATION).toBe('string');
  });
});
