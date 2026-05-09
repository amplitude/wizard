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
//
// The id regexes live in `./id-schemas` so the `checkpoints/*` and
// `mcp-app-lifecycle.ts` modules can import them without forming a
// cycle through this file. Re-exported here so callers that go through
// the schemas barrel keep working.

export { SessionIdSchema, TaskIdSchema, SubagentIdSchema } from './id-schemas';
import { SessionIdSchema, TaskIdSchema, SubagentIdSchema } from './id-schemas';

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

// ── Checkpoint + MCP-app lifecycle re-exports ────────────────────────
//
// Re-exported from this module so consumers can import the full
// orchestration I/O surface from a single place. The transition
// validators (`assertChoiceTransition`, `assertVerificationTransition`,
// `assertMcpTransition`) live in their respective modules and are
// re-exported through `index.ts`.

import {
  ChoiceSchema,
  ChoiceKindSchema,
  ChoiceStatusSchema,
  ChoiceOptionSchema,
  TimeoutBehaviorSchema,
  ChoiceIdSchema,
} from './checkpoints/choices';
import {
  VerificationSchema,
  VerificationKindSchema,
  VerificationStatusSchema,
  VerificationIdSchema,
} from './checkpoints/verifications';
import {
  McpAppCapabilitySchema,
  McpAppCapabilityKindSchema,
  McpAppCapabilityStateSchema,
  McpUserDecisionSchema,
  McpAppCapabilityIdSchema,
} from './mcp-app-lifecycle';

export {
  ChoiceSchema,
  ChoiceKindSchema,
  ChoiceStatusSchema,
  ChoiceOptionSchema,
  TimeoutBehaviorSchema,
  ChoiceIdSchema,
  VerificationSchema,
  VerificationKindSchema,
  VerificationStatusSchema,
  VerificationIdSchema,
  McpAppCapabilitySchema,
  McpAppCapabilityKindSchema,
  McpAppCapabilityStateSchema,
  McpUserDecisionSchema,
  McpAppCapabilityIdSchema,
};

// ── Store envelope ────────────────────────────────────────────────────

export const OrchestrationStoreFileSchema = z.object({
  version: z.literal(ORCHESTRATION_STORE_VERSION),
  updatedAt: z.string(),
  installDir: z.string().min(1),
  sessions: z.array(SessionSchema),
  tasks: z.array(TaskSchema),
  subagents: z.array(SubagentSchema),
  /**
   * PR 2 additions. Optional in the schema (default to empty array on
   * read) so an on-disk file written by the PR 1 binary still parses
   * cleanly — the version literal stays at 1 because the additions are
   * read-time backwards-compatible (older readers ignore the fields).
   */
  choices: z.array(ChoiceSchema).default([]),
  verifications: z.array(VerificationSchema).default([]),
  mcpCapabilities: z.array(McpAppCapabilitySchema).default([]),
});

// ── CLI envelope schemas ─────────────────────────────────────────────

/**
 * Envelope returned by `wizard orchestration status --json`. Wraps the LSP
 * with the schema version so consumers can branch on version.
 */
export const StatusEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.literal('orchestration_status'),
  generatedAt: z.string(),
  installDir: z.string(),
  storePath: z.string(),
  storeExists: z.boolean(),
  lastStoppingPoint: LastStoppingPointSchema,
});

/** Envelope returned by `wizard tasks --json`. */
export const TasksEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.literal('orchestration_tasks'),
  generatedAt: z.string(),
  installDir: z.string(),
  tasks: z.array(TaskSchema),
});

/** Envelope returned by `wizard task <id> --json`. */
export const TaskEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.literal('orchestration_task'),
  generatedAt: z.string(),
  installDir: z.string(),
  task: TaskSchema,
});

/** Envelope returned by `wizard sessions --json`. */
export const SessionsEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.literal('orchestration_sessions'),
  generatedAt: z.string(),
  installDir: z.string(),
  sessions: z.array(SessionSchema),
});

/** Envelope returned by `wizard session <id> --json`. */
export const SessionEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.literal('orchestration_session'),
  generatedAt: z.string(),
  installDir: z.string(),
  session: SessionSchema,
  tasks: z.array(TaskSchema),
});

/** Envelope returned by `wizard resume <session-id> --json`. */
export const ResumeEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.literal('orchestration_resume'),
  generatedAt: z.string(),
  installDir: z.string(),
  sessionId: SessionIdSchema,
  command: z.array(z.string()),
  description: z.string(),
  executed: z.boolean(),
});

// ── PR 2: choice / verification / mcp-capability envelopes ──────────

export const ChoicesEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.literal('orchestration_choices'),
  generatedAt: z.string(),
  installDir: z.string(),
  choices: z.array(ChoiceSchema),
});

export const ChoiceEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.literal('orchestration_choice'),
  generatedAt: z.string(),
  installDir: z.string(),
  choice: ChoiceSchema,
});

export const ChoiceAnswerEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.literal('orchestration_choice_answer'),
  generatedAt: z.string(),
  installDir: z.string(),
  choice: ChoiceSchema,
});

export const VerificationsEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.literal('orchestration_verifications'),
  generatedAt: z.string(),
  installDir: z.string(),
  verifications: z.array(VerificationSchema),
});

export const VerificationEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.literal('orchestration_verification'),
  generatedAt: z.string(),
  installDir: z.string(),
  verification: VerificationSchema,
});

export const VerificationMarkEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.literal('orchestration_verification_mark'),
  generatedAt: z.string(),
  installDir: z.string(),
  verification: VerificationSchema,
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
export type ZodChoicesEnvelope = z.infer<typeof ChoicesEnvelopeSchema>;
export type ZodChoiceEnvelope = z.infer<typeof ChoiceEnvelopeSchema>;
export type ZodChoiceAnswerEnvelope = z.infer<
  typeof ChoiceAnswerEnvelopeSchema
>;
export type ZodVerificationsEnvelope = z.infer<
  typeof VerificationsEnvelopeSchema
>;
export type ZodVerificationEnvelope = z.infer<
  typeof VerificationEnvelopeSchema
>;
export type ZodVerificationMarkEnvelope = z.infer<
  typeof VerificationMarkEnvelopeSchema
>;
