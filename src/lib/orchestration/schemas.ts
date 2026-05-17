/**
 * Zod schemas for orchestration state.
 *
 * Source of truth for the on-disk format and the JSON envelope `wizard
 * status`/`tasks`/`sessions`/`session`/`task` emit. Every CLI handler
 * validates its output against these schemas before writing to stdout, so a
 * regression in the producer surfaces as a test failure rather than an
 * orchestrator-side parse error.
 *
 * Why both runtime + types: the `state.ts` types are the developer-facing
 * shape (used inside the wizard); `schemas.ts` is the I/O boundary. Anywhere
 * we cross a process boundary (file read, stdout write, MCP-server response)
 * we go through these schemas.
 */
import { z } from 'zod';
import { TaskLifecycle } from './lifecycle';
import { ORCHESTRATION_STORE_VERSION } from './state';

// ── ID schemas ───────────────────────────────────────────────────────

export const SessionIdSchema = z
  .string()
  .regex(/^session_[A-Za-z0-9_-]+$/, 'expected session_<id>');
export const TaskIdSchema = z
  .string()
  .regex(/^task_[A-Za-z0-9_-]+$/, 'expected task_<id>');
export const SubagentIdSchema = z
  .string()
  .regex(/^subagent_[A-Za-z0-9_-]+$/, 'expected subagent_<id>');

// ── Lifecycle ────────────────────────────────────────────────────────

export const TaskLifecycleSchema = z.enum([
  TaskLifecycle.Queued,
  TaskLifecycle.Running,
  TaskLifecycle.WaitingForUser,
  TaskLifecycle.Blocked,
  TaskLifecycle.Completed,
  TaskLifecycle.Failed,
  TaskLifecycle.Cancelled,
  TaskLifecycle.Superseded,
]);

export const SubagentKindSchema = z.enum([
  'framework_detection',
  'integration',
  'taxonomy',
  'instrumentation',
  'chart_creation',
  'dashboard_creation',
  'verification',
  'feature_discovery',
  'mcp_install',
  'unknown',
]);

// ── Ownership ────────────────────────────────────────────────────────

export const OwnershipSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('branch'),
    name: z.string().min(1),
    remote: z.string().optional(),
  }),
  z.object({
    kind: z.literal('worktree'),
    path: z.string().min(1),
    branch: z.string().optional(),
  }),
  z.object({
    kind: z.literal('pull_request'),
    number: z.number().int().positive(),
    repo: z.string().min(1),
    url: z.string().url(),
    state: z.enum(['open', 'closed', 'merged']).optional(),
  }),
  z.object({
    kind: z.literal('file'),
    path: z.string().min(1),
  }),
]);

// ── Pending checkpoint (PR 1 stub) ───────────────────────────────────

export const PendingCheckpointSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  summary: z.string().optional(),
  enteredAt: z.number().int().nonnegative(),
});

// ── Task result ──────────────────────────────────────────────────────

export const TaskResultSchema = z.object({
  outcome: z.enum(['completed', 'failed', 'cancelled', 'superseded']),
  summary: z.string().optional(),
  error: z
    .object({
      message: z.string(),
      class: z.enum([
        'auth',
        'network',
        'validation',
        'permission',
        'cancelled',
        'internal',
        'unknown',
      ]),
      code: z.string().optional(),
    })
    .optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  finishedAt: z.number().int().nonnegative(),
});

// ── Task ──────────────────────────────────────────────────────────────

export const TaskSchema = z.object({
  id: TaskIdSchema,
  sessionId: SessionIdSchema,
  label: z.string().min(1),
  activeForm: z.string().optional(),
  state: TaskLifecycleSchema,
  ownership: z.array(OwnershipSchema),
  waitingFor: PendingCheckpointSchema.optional(),
  blockedReason: z.string().optional(),
  parentTaskId: TaskIdSchema.optional(),
  subagentKind: SubagentKindSchema.nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative().nullable(),
  result: TaskResultSchema.optional(),
  supersededBy: TaskIdSchema.optional(),
});

// ── Subagent ──────────────────────────────────────────────────────────

export const SubagentSchema = z.object({
  id: SubagentIdSchema,
  sessionId: SessionIdSchema,
  kind: SubagentKindSchema,
  rootTaskId: TaskIdSchema,
  createdAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative().nullable(),
});

// ── Session ───────────────────────────────────────────────────────────

export const SessionSchema = z.object({
  id: SessionIdSchema,
  installDir: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  goal: z.string().optional(),
  branch: z.string().optional(),
  worktree: z.string().optional(),
  status: z.enum(['active', 'succeeded', 'failed', 'cancelled', 'abandoned']),
  finishedAt: z.number().int().nonnegative().optional(),
});

// ── Last-stopping-point ──────────────────────────────────────────────

export const NextActionSchema = z.object({
  kind: z.enum([
    'resume',
    'fix_auth',
    'await_user_choice',
    'await_mcp_action',
    'await_verification',
    'inspect_failure',
    'none',
  ]),
  description: z.string().min(1),
  command: z.array(z.string()),
});

export const LastStoppingPointSchema = z.object({
  generatedAt: z.number().int().nonnegative(),
  currentSessionId: SessionIdSchema.nullable(),
  currentGoal: z.string().nullable(),
  currentBranch: z.string().nullable(),
  currentWorktree: z.string().nullable(),
  activeTasks: z.array(TaskSchema),
  stoppedTasks: z.array(TaskSchema),
  recentlyCompletedTasks: z.array(TaskSchema),
  relevantOwnership: z.array(OwnershipSchema),
  pendingChoices: z.array(PendingCheckpointSchema),
  pendingMcpActions: z.array(PendingCheckpointSchema),
  pendingManualVerifications: z.array(PendingCheckpointSchema),
  nextAction: NextActionSchema,
  resumeCommand: z.string(),
});

// ── Store envelope ────────────────────────────────────────────────────

export const OrchestrationStoreFileSchema = z.object({
  version: z.literal(ORCHESTRATION_STORE_VERSION),
  updatedAt: z.string(),
  installDir: z.string().min(1),
  sessions: z.array(SessionSchema),
  tasks: z.array(TaskSchema),
  subagents: z.array(SubagentSchema),
});

// ── CLI envelope schemas ─────────────────────────────────────────────

/**
 * Shared fields stamped onto every `--json` envelope after `v` and `type`:
 * the wall-clock generation timestamp and the install dir the snapshot
 * belongs to. Each envelope defines `v` and `type` inline first, then
 * spreads these, so the wire key order stays `v, type, generatedAt,
 * installDir, …payload` — byte-identical to the prior inline definitions.
 */
const ENVELOPE_BASE_FIELDS = {
  generatedAt: z.string(),
  installDir: z.string(),
} as const;

/**
 * Envelope returned by `wizard orchestration status --json`. Wraps the LSP
 * with the schema version so consumers can branch on version.
 */
export const StatusEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.literal('orchestration_status'),
  ...ENVELOPE_BASE_FIELDS,
  storePath: z.string(),
  storeExists: z.boolean(),
  lastStoppingPoint: LastStoppingPointSchema,
});

/** Envelope returned by `wizard tasks --json`. */
export const TasksEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.literal('orchestration_tasks'),
  ...ENVELOPE_BASE_FIELDS,
  tasks: z.array(TaskSchema),
});

/** Envelope returned by `wizard task <id> --json`. */
export const TaskEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.literal('orchestration_task'),
  ...ENVELOPE_BASE_FIELDS,
  task: TaskSchema,
});

/** Envelope returned by `wizard sessions --json`. */
export const SessionsEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.literal('orchestration_sessions'),
  ...ENVELOPE_BASE_FIELDS,
  sessions: z.array(SessionSchema),
});

/** Envelope returned by `wizard session <id> --json`. */
export const SessionEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.literal('orchestration_session'),
  ...ENVELOPE_BASE_FIELDS,
  session: SessionSchema,
  tasks: z.array(TaskSchema),
});

/** Envelope returned by `wizard resume <session-id> --json`. */
export const ResumeEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.literal('orchestration_resume'),
  ...ENVELOPE_BASE_FIELDS,
  sessionId: SessionIdSchema,
  command: z.array(z.string()),
  description: z.string(),
  executed: z.boolean(),
});

// ── Inferred types — runtime checks should use `.parse()` ─────────────

export type ZodTask = z.infer<typeof TaskSchema>;
export type ZodSession = z.infer<typeof SessionSchema>;
export type ZodSubagent = z.infer<typeof SubagentSchema>;
export type ZodOwnership = z.infer<typeof OwnershipSchema>;
export type ZodLastStoppingPoint = z.infer<typeof LastStoppingPointSchema>;
export type ZodOrchestrationStoreFile = z.infer<
  typeof OrchestrationStoreFileSchema
>;
export type ZodStatusEnvelope = z.infer<typeof StatusEnvelopeSchema>;
export type ZodTasksEnvelope = z.infer<typeof TasksEnvelopeSchema>;
export type ZodTaskEnvelope = z.infer<typeof TaskEnvelopeSchema>;
export type ZodSessionsEnvelope = z.infer<typeof SessionsEnvelopeSchema>;
export type ZodSessionEnvelope = z.infer<typeof SessionEnvelopeSchema>;
export type ZodResumeEnvelope = z.infer<typeof ResumeEnvelopeSchema>;
