/**
 * Choice schema, status transitions, and store-level de-dup tests.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { OrchestrationStore, _resetOrchestrationStoreCache } from '../../store';
import {
  ChoiceKind,
  ChoiceStatus,
  ChoiceSchema,
  IllegalChoiceTransitionError,
  assertChoiceTransition,
  canTransitionChoice,
  asChoiceId,
} from '../choices';

let cacheRoot: string;
let installDir: string;

beforeEach(() => {
  cacheRoot = mkdtempSync(join(tmpdir(), 'orch-choices-'));
  installDir = mkdtempSync(join(tmpdir(), 'orch-choices-install-'));
  process.env.AMPLITUDE_WIZARD_CACHE_DIR = cacheRoot;
  _resetOrchestrationStoreCache();
});

afterEach(() => {
  rmSync(cacheRoot, { recursive: true, force: true });
  rmSync(installDir, { recursive: true, force: true });
  delete process.env.AMPLITUDE_WIZARD_CACHE_DIR;
  _resetOrchestrationStoreCache();
});

describe('ChoiceSchema — round-trip', () => {
  it('parses a valid Choice and rejects invalid ones', () => {
    const valid = {
      id: 'choice_abc123',
      kind: ChoiceKind.EnvironmentSelection,
      promptId: 'env_selection',
      message: 'Pick an env',
      options: [{ id: 'opt-prod', label: 'Production' }],
      recommendedOptionId: 'opt-prod',
      safeDefaultOptionId: 'opt-prod',
      requiresHuman: true,
      automationAllowed: false,
      timeoutBehavior: null,
      consequenceIfSkipped: 'no env, no events',
      reversible: true,
      whyAsking: 'multiple envs available',
      status: ChoiceStatus.Pending,
      answeredOptionId: null,
      answeredBy: null,
      createdAt: new Date().toISOString(),
      answeredAt: null,
      expiresAt: null,
      resumeCommand: ['wizard', '--agent'],
      linkedTaskId: null,
      linkedSessionId: 'session_abc',
    };
    const parsed = ChoiceSchema.parse(valid);
    expect(parsed.id).toBe(valid.id);

    // Bad id prefix.
    expect(() =>
      ChoiceSchema.parse({ ...valid, id: 'not_a_choice' }),
    ).toThrow();
    // Empty options array.
    expect(() => ChoiceSchema.parse({ ...valid, options: [] })).toThrow();
  });
});

describe('Choice status transitions', () => {
  it('pending -> answered/expired/cancelled/superseded all legal', () => {
    expect(
      canTransitionChoice(ChoiceStatus.Pending, ChoiceStatus.Answered),
    ).toBe(true);
    expect(
      canTransitionChoice(ChoiceStatus.Pending, ChoiceStatus.Expired),
    ).toBe(true);
    expect(
      canTransitionChoice(ChoiceStatus.Pending, ChoiceStatus.Cancelled),
    ).toBe(true);
    expect(
      canTransitionChoice(ChoiceStatus.Pending, ChoiceStatus.Superseded),
    ).toBe(true);
  });

  it('answered/expired/cancelled cannot revert to pending', () => {
    expect(
      canTransitionChoice(ChoiceStatus.Answered, ChoiceStatus.Pending),
    ).toBe(false);
    expect(
      canTransitionChoice(ChoiceStatus.Expired, ChoiceStatus.Pending),
    ).toBe(false);
    expect(
      canTransitionChoice(ChoiceStatus.Cancelled, ChoiceStatus.Pending),
    ).toBe(false);
  });

  it('superseded is terminal', () => {
    expect(
      canTransitionChoice(ChoiceStatus.Superseded, ChoiceStatus.Answered),
    ).toBe(false);
  });

  it('assertChoiceTransition throws IllegalChoiceTransitionError on bad arc', () => {
    expect(() =>
      assertChoiceTransition(
        'choice_x',
        ChoiceStatus.Answered,
        ChoiceStatus.Pending,
      ),
    ).toThrow(IllegalChoiceTransitionError);
  });
});

describe('OrchestrationStore — choice de-dup by promptId', () => {
  it('addChoice with the same promptId returns the existing record', () => {
    const store = new OrchestrationStore(installDir);
    const session = store.createSession({});
    const first = store.addChoice({
      kind: ChoiceKind.EventPlanApproval,
      promptId: 'plan:hash-abc',
      message: 'Approve plan?',
      options: [{ id: 'approve', label: 'Approve' }],
      recommendedOptionId: 'approve',
      safeDefaultOptionId: 'approve',
      requiresHuman: false,
      automationAllowed: true,
      timeoutBehavior: null,
      consequenceIfSkipped: 'no events tracked',
      reversible: true,
      whyAsking: 'agent proposed events',
      resumeCommand: ['wizard', '--agent'],
      linkedSessionId: session.id,
    });
    const second = store.addChoice({
      kind: ChoiceKind.EventPlanApproval,
      promptId: 'plan:hash-abc',
      message: 'Approve plan? (retry)',
      options: [{ id: 'approve', label: 'Approve' }],
      recommendedOptionId: 'approve',
      safeDefaultOptionId: 'approve',
      requiresHuman: false,
      automationAllowed: true,
      timeoutBehavior: null,
      consequenceIfSkipped: 'no events tracked',
      reversible: true,
      whyAsking: 'agent proposed events',
      resumeCommand: ['wizard', '--agent'],
      linkedSessionId: session.id,
    });
    expect(second.id).toBe(first.id);
    expect(store.listChoices().length).toBe(1);
  });

  it('findPendingChoice locates the active record', () => {
    const store = new OrchestrationStore(installDir);
    const session = store.createSession({});
    const c = store.addChoice({
      kind: ChoiceKind.McpInstall,
      promptId: 'mcp:install:claude_code',
      message: 'Install Claude Code MCP?',
      options: [
        { id: 'yes', label: 'Yes' },
        { id: 'no', label: 'Skip' },
      ],
      recommendedOptionId: 'yes',
      safeDefaultOptionId: 'no',
      requiresHuman: true,
      automationAllowed: false,
      timeoutBehavior: null,
      consequenceIfSkipped: 'editor cannot call wizard tools',
      reversible: true,
      whyAsking: 'user runs Claude Code',
      resumeCommand: ['wizard', 'mcp', 'install'],
      linkedSessionId: session.id,
    });
    const found = store.findPendingChoice('mcp:install:claude_code');
    expect(found?.id).toBe(c.id);
  });
});

describe('OrchestrationStore — answerChoice', () => {
  it('answerChoice transitions pending -> answered with the picked option', () => {
    const store = new OrchestrationStore(installDir);
    const session = store.createSession({});
    const c = store.addChoice({
      kind: ChoiceKind.SlackSetup,
      promptId: 'slack:setup',
      message: 'Connect Slack?',
      options: [
        { id: 'yes', label: 'Yes' },
        { id: 'no', label: 'No' },
      ],
      recommendedOptionId: 'yes',
      safeDefaultOptionId: 'no',
      requiresHuman: true,
      automationAllowed: false,
      timeoutBehavior: null,
      consequenceIfSkipped: 'no slack alerts',
      reversible: true,
      whyAsking: 'user installed slack app',
      resumeCommand: ['wizard'],
      linkedSessionId: session.id,
    });
    const updated = store.answerChoice(asChoiceId(c.id), 'yes', 'human');
    expect(updated.status).toBe(ChoiceStatus.Answered);
    expect(updated.answeredOptionId).toBe('yes');
    expect(updated.answeredBy).toBe('human');
    expect(updated.answeredAt).not.toBeNull();
  });

  it('answerChoice rejects an unknown option id', () => {
    const store = new OrchestrationStore(installDir);
    const session = store.createSession({});
    const c = store.addChoice({
      kind: ChoiceKind.AuthRetry,
      promptId: 'auth:retry',
      message: 'Retry login?',
      options: [{ id: 'yes', label: 'Yes' }],
      recommendedOptionId: 'yes',
      safeDefaultOptionId: 'yes',
      requiresHuman: true,
      automationAllowed: false,
      timeoutBehavior: null,
      consequenceIfSkipped: 'cannot continue',
      reversible: false,
      whyAsking: 'token expired',
      resumeCommand: ['wizard', 'login'],
      linkedSessionId: session.id,
    });
    expect(() =>
      store.answerChoice(
        asChoiceId(c.id),
        'definitely-not-a-real-option',
        'human',
      ),
    ).toThrow(/option/);
  });

  it('answerChoice on a non-pending choice throws', () => {
    const store = new OrchestrationStore(installDir);
    const session = store.createSession({});
    const c = store.addChoice({
      kind: ChoiceKind.Other,
      promptId: 'other:x',
      message: 'pick',
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
    store.answerChoice(asChoiceId(c.id), 'a', 'human');
    expect(() => store.answerChoice(asChoiceId(c.id), 'a', 'human')).toThrow(
      IllegalChoiceTransitionError,
    );
  });
});

describe('asChoiceId', () => {
  it('throws on a non-choice prefix', () => {
    expect(() => asChoiceId('task_abc')).toThrow();
  });
});
