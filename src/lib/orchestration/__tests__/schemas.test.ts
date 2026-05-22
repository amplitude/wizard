/**
 * Zod schema round-trip tests.
 *
 * Every persisted shape must survive parse → serialize → parse without loss.
 * Without these, a future contributor adding an optional field to the TS type
 * but forgetting the schema would silently drop it on disk and the `wizard
 * status --json` output would diverge from the in-memory shape.
 */
import { describe, it, expect } from 'vitest';

import {
  TaskSchema,
  SessionSchema,
  SubagentSchema,
  OrchestrationStoreFileSchema,
  OwnershipSchema,
  TaskResultSchema,
  StatusEnvelopeSchema,
  TasksEnvelopeSchema,
  TaskEnvelopeSchema,
  SessionsEnvelopeSchema,
  SessionEnvelopeSchema,
  ResumeEnvelopeSchema,
} from '../schemas';
import { ORCHESTRATION_STORE_VERSION } from '../state';
import { TaskLifecycle } from '../lifecycle';

const NOW = 1_715_000_000_000; // Pinned ms timestamp; deterministic across CI.

describe('Task schema round-trip', () => {
  const sample = {
    id: 'task_abcdef0123',
    sessionId: 'session_xyz9876543',
    label: 'install Amplitude SDK',
    activeForm: 'installing Amplitude SDK',
    state: TaskLifecycle.Running,
    ownership: [
      { kind: 'branch', name: 'feat/orchestration' },
      {
        kind: 'pull_request',
        number: 42,
        repo: 'amplitude/wizard',
        url: 'https://github.com/amplitude/wizard/pull/42',
        state: 'open',
      },
    ],
    parentTaskId: 'task_parent12345',
    subagentKind: 'integration',
    createdAt: NOW - 1_000,
    updatedAt: NOW,
    startedAt: NOW - 500,
  } as const;

  it('parses a valid task', () => {
    const parsed = TaskSchema.parse(sample);
    expect(parsed.id).toBe(sample.id);
    expect(parsed.state).toBe(TaskLifecycle.Running);
  });

  it('round-trips through JSON without loss', () => {
    const parsed = TaskSchema.parse(sample);
    const serialized = JSON.stringify(parsed);
    const reparsed = TaskSchema.parse(JSON.parse(serialized));
    expect(reparsed).toEqual(parsed);
  });

  it('rejects malformed task ids', () => {
    expect(() => TaskSchema.parse({ ...sample, id: 'not-a-task-id' })).toThrow(
      /expected task_/,
    );
  });

  it('rejects unknown lifecycle states', () => {
    expect(() =>
      TaskSchema.parse({ ...sample, state: 'in_orbit' as never }),
    ).toThrow();
  });

  it('rejects ownership that is not in the discriminated union', () => {
    expect(() =>
      TaskSchema.parse({
        ...sample,
        ownership: [{ kind: 'imaginary', name: 'foo' }],
      }),
    ).toThrow();
  });
});

describe('Session schema', () => {
  it('accepts every documented status value', () => {
    for (const status of [
      'active',
      'succeeded',
      'failed',
      'cancelled',
      'abandoned',
    ] as const) {
      const session = SessionSchema.parse({
        id: 'session_abcdef',
        installDir: '/tmp/proj',
        createdAt: NOW,
        updatedAt: NOW,
        status,
      });
      expect(session.status).toBe(status);
    }
  });
});

describe('Subagent schema', () => {
  it('accepts a subagent with finishedAt null (still running)', () => {
    const sub = SubagentSchema.parse({
      id: 'subagent_abc',
      sessionId: 'session_def',
      kind: 'integration',
      rootTaskId: 'task_root',
      createdAt: NOW,
      finishedAt: null,
    });
    expect(sub.finishedAt).toBeNull();
  });
});

describe('Ownership schema', () => {
  it('accepts every kind in the discriminated union', () => {
    expect(OwnershipSchema.parse({ kind: 'branch', name: 'main' }).kind).toBe(
      'branch',
    );
    expect(
      OwnershipSchema.parse({ kind: 'worktree', path: '/tmp/wt' }).kind,
    ).toBe('worktree');
    expect(
      OwnershipSchema.parse({
        kind: 'pull_request',
        number: 1,
        repo: 'x/y',
        url: 'https://github.com/x/y/pull/1',
      }).kind,
    ).toBe('pull_request');
    expect(OwnershipSchema.parse({ kind: 'file', path: '/x' }).kind).toBe(
      'file',
    );
  });
});

describe('TaskResult schema', () => {
  it('accepts a completed result without error', () => {
    const r = TaskResultSchema.parse({
      outcome: 'completed',
      summary: 'all good',
      finishedAt: NOW,
    });
    expect(r.outcome).toBe('completed');
  });

  it('accepts a failed result with structured error', () => {
    const r = TaskResultSchema.parse({
      outcome: 'failed',
      finishedAt: NOW,
      error: {
        message: 'auth expired',
        class: 'auth',
        code: 'TOKEN_EXPIRED',
      },
    });
    expect(r.error?.class).toBe('auth');
  });

  it('rejects an error with an unknown class', () => {
    expect(() =>
      TaskResultSchema.parse({
        outcome: 'failed',
        finishedAt: NOW,
        error: { message: 'x', class: 'cosmic_rays' },
      }),
    ).toThrow();
  });
});

describe('OrchestrationStoreFile schema', () => {
  it('round-trips an empty store', () => {
    const empty = {
      version: ORCHESTRATION_STORE_VERSION,
      updatedAt: new Date(NOW).toISOString(),
      installDir: '/tmp/proj',
      sessions: [],
      tasks: [],
      subagents: [],
    };
    const parsed = OrchestrationStoreFileSchema.parse(empty);
    const reparsed = OrchestrationStoreFileSchema.parse(
      JSON.parse(JSON.stringify(parsed)),
    );
    expect(reparsed).toEqual(parsed);
  });

  it('rejects a store with a wrong version literal', () => {
    expect(() =>
      OrchestrationStoreFileSchema.parse({
        version: 99,
        updatedAt: new Date(NOW).toISOString(),
        installDir: '/tmp/proj',
        sessions: [],
        tasks: [],
        subagents: [],
      }),
    ).toThrow();
  });
});

describe('Envelope schemas share the v1 base header fields', () => {
  // Lock in the shared base-fields contract that every `--json` envelope
  // surfaces. Outer agents key off these three fields (`v`, `generatedAt`,
  // `installDir`) before branching on `type`; if a future contributor
  // accidentally drops or renames one of them in `schemas.ts` this test
  // surfaces the regression instead of letting CLI consumers break silently.
  const base = {
    v: 1 as const,
    generatedAt: new Date(NOW).toISOString(),
    installDir: '/tmp/proj',
  };
  it('TasksEnvelope accepts the base header + an empty tasks array', () => {
    expect(() =>
      TasksEnvelopeSchema.parse({
        ...base,
        type: 'orchestration_tasks',
        tasks: [],
      }),
    ).not.toThrow();
  });
  it('TaskEnvelope, Sessions, Session, Resume all accept the base header', () => {
    const sample = SessionSchema.parse({
      id: 'session_abc',
      installDir: '/tmp/proj',
      createdAt: NOW,
      updatedAt: NOW,
      status: 'active',
    });
    expect(() =>
      SessionsEnvelopeSchema.parse({
        ...base,
        type: 'orchestration_sessions',
        sessions: [sample],
      }),
    ).not.toThrow();
    expect(() =>
      SessionEnvelopeSchema.parse({
        ...base,
        type: 'orchestration_session',
        session: sample,
        tasks: [],
      }),
    ).not.toThrow();
    expect(() =>
      ResumeEnvelopeSchema.parse({
        ...base,
        type: 'orchestration_resume',
        sessionId: 'session_abc',
        command: ['amplitude-wizard'],
        description: 'go',
        executed: false,
      }),
    ).not.toThrow();
    // TaskEnvelope: build a minimal task that satisfies TaskSchema first.
    const task = TaskSchema.parse({
      id: 'task_x',
      sessionId: 'session_abc',
      label: 't',
      state: TaskLifecycle.Queued,
      ownership: [],
      subagentKind: null,
      createdAt: NOW,
      updatedAt: NOW,
      startedAt: null,
    });
    expect(() =>
      TaskEnvelopeSchema.parse({ ...base, type: 'orchestration_task', task }),
    ).not.toThrow();
  });
});

describe('StatusEnvelope schema', () => {
  it('validates a synthesized envelope shape', () => {
    const envelope = {
      v: 1 as const,
      type: 'orchestration_status' as const,
      generatedAt: new Date(NOW).toISOString(),
      installDir: '/tmp/proj',
      storePath: '/tmp/store.json',
      storeExists: false,
      lastStoppingPoint: {
        generatedAt: NOW,
        currentSessionId: null,
        currentGoal: null,
        currentBranch: null,
        currentWorktree: null,
        activeTasks: [],
        stoppedTasks: [],
        recentlyCompletedTasks: [],
        relevantOwnership: [],
        pendingChoices: [],
        pendingMcpActions: [],
        pendingManualVerifications: [],
        nextAction: {
          kind: 'none' as const,
          description: 'No active or recently stopped tasks.',
          command: ['amplitude-wizard'],
        },
        resumeCommand: 'amplitude-wizard',
      },
    };
    expect(() => StatusEnvelopeSchema.parse(envelope)).not.toThrow();
  });
});
