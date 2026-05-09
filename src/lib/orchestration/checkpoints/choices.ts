/**
 * User-choice checkpoints — typed `Choice` model.
 *
 * Part of the v2 PR 2 foundation. A `Choice` is a discrete decision the
 * wizard needs from a human (or, when `automationAllowed === true`, the
 * orchestrator on the human's behalf). Each choice carries:
 *
 *   - a stable `promptId` so the wizard never asks the same question twice
 *     (de-dup helper: `findPendingChoice(promptId)`),
 *   - `requiresHuman` — automation MUST NOT pick when true; the
 *     `wizard choice answer` CLI command refuses to act unless the
 *     operator passes `--confirm-human`,
 *   - `safeDefaultOptionId` — the option `pick_safe_default` selects when
 *     `timeoutBehavior.action === 'pick_safe_default'` fires,
 *   - `consequenceIfSkipped` and `whyAsking` — context used by the TUI
 *     (PR 3) and outer agents to render a human-friendly explanation.
 *
 * The model is intentionally orthogonal to `PendingCheckpoint` (PR 1):
 * `PendingCheckpoint` is the lightweight "task is paused on something"
 * marker stored on the task itself; `Choice` is the full structured
 * record stored on the orchestration store. The two cross-reference via
 * `linkedTaskId`.
 *
 * No callers outside the orchestration module should construct `Choice`
 * objects directly — go through `OrchestrationStore.addChoice`. The
 * factory normalizes ids and timestamps and validates the shape against
 * `ChoiceSchema` before write.
 */
import { z } from 'zod';

import { SessionIdSchema, TaskIdSchema } from '../id-schemas';
import type { SessionId, TaskId } from '../state';

// ── Enums ────────────────────────────────────────────────────────────

/**
 * Coarse classifier for what the user is being asked. Stays a string union
 * (not a Zod-bound enum) so future kinds can be added without a schema bump
 * — readers fall through to `other` on unknown values.
 */
export const ChoiceKind = {
  EnvironmentSelection: 'environment_selection',
  EventPlanApproval: 'event_plan_approval',
  EventPlanRevision: 'event_plan_revision',
  McpInstall: 'mcp_install',
  McpAuth: 'mcp_auth',
  SlackSetup: 'slack_setup',
  DashboardSetup: 'dashboard_setup',
  DataIngestionCheck: 'data_ingestion_check',
  KeepOrRevertFiles: 'keep_or_revert_files',
  AuthRetry: 'auth_retry',
  ManualVerification: 'manual_verification',
  Other: 'other',
} as const;
export type ChoiceKind = (typeof ChoiceKind)[keyof typeof ChoiceKind];

/**
 * A choice progresses through these states. Once `answered`, the choice
 * is immutable except for re-supersede.
 */
export const ChoiceStatus = {
  Pending: 'pending',
  Answered: 'answered',
  Expired: 'expired',
  Cancelled: 'cancelled',
  Superseded: 'superseded',
} as const;
export type ChoiceStatus = (typeof ChoiceStatus)[keyof typeof ChoiceStatus];

const TERMINAL_CHOICE_STATUSES = new Set<ChoiceStatus>([
  ChoiceStatus.Answered,
  ChoiceStatus.Expired,
  ChoiceStatus.Cancelled,
  ChoiceStatus.Superseded,
]);

export function isTerminalChoiceStatus(s: ChoiceStatus): boolean {
  return TERMINAL_CHOICE_STATUSES.has(s);
}

// ── Schemas ──────────────────────────────────────────────────────────

export const ChoiceIdSchema = z
  .string()
  .regex(/^choice_[A-Za-z0-9_-]+$/, 'expected choice_<id>');

export const ChoiceKindSchema = z.enum([
  ChoiceKind.EnvironmentSelection,
  ChoiceKind.EventPlanApproval,
  ChoiceKind.EventPlanRevision,
  ChoiceKind.McpInstall,
  ChoiceKind.McpAuth,
  ChoiceKind.SlackSetup,
  ChoiceKind.DashboardSetup,
  ChoiceKind.DataIngestionCheck,
  ChoiceKind.KeepOrRevertFiles,
  ChoiceKind.AuthRetry,
  ChoiceKind.ManualVerification,
  ChoiceKind.Other,
]);

export const ChoiceStatusSchema = z.enum([
  ChoiceStatus.Pending,
  ChoiceStatus.Answered,
  ChoiceStatus.Expired,
  ChoiceStatus.Cancelled,
  ChoiceStatus.Superseded,
]);

export const ChoiceOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  isRecommended: z.boolean().optional(),
  isSafestSkip: z.boolean().optional(),
  consequence: z.string().optional(),
});

export const TimeoutBehaviorSchema = z.object({
  ms: z.number().int().nonnegative().optional(),
  action: z.enum(['pick_safe_default', 'block', 'fail']),
});

export const ChoiceSchema = z.object({
  id: ChoiceIdSchema,
  kind: ChoiceKindSchema,
  /**
   * Stable identifier the producer uses for de-dup. The same prompt
   * (`promptId === 'event_plan_approval:<events-hash>'`) MUST resolve
   * to the same record across retries — `findPendingChoice(promptId)`
   * is the canonical lookup.
   */
  promptId: z.string().min(1),
  message: z.string().min(1),
  options: z.array(ChoiceOptionSchema).min(1),
  recommendedOptionId: z.string().nullable(),
  safeDefaultOptionId: z.string().nullable(),
  /**
   * Automation MUST NOT pick on the user's behalf when true. The
   * `wizard choice answer` CLI command enforces this — it rejects an
   * answer attempt unless the operator explicitly passes
   * `--confirm-human` (the operator asserts a human is present).
   */
  requiresHuman: z.boolean(),
  /** When true, automation may pick `safeDefaultOptionId` after timeout. */
  automationAllowed: z.boolean(),
  timeoutBehavior: TimeoutBehaviorSchema.nullable(),
  consequenceIfSkipped: z.string(),
  /** Whether the choice can be revisited later. */
  reversible: z.boolean(),
  /** Brief explanation of why the wizard is asking right now. */
  whyAsking: z.string(),
  status: ChoiceStatusSchema,
  answeredOptionId: z.string().nullable(),
  answeredBy: z.enum(['human', 'automation']).nullable(),
  /** ISO-8601 timestamps. */
  createdAt: z.string(),
  answeredAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  /** Exact CLI invocation to revisit when reversible. */
  resumeCommand: z.array(z.string()),
  /** Owning task / session — both required so cross-refs are deterministic. */
  linkedTaskId: TaskIdSchema.nullable(),
  linkedSessionId: SessionIdSchema,
});

// ── TS types ─────────────────────────────────────────────────────────

export type ChoiceId = `choice_${string}`;
export type ChoiceOption = z.infer<typeof ChoiceOptionSchema>;
export type TimeoutBehavior = z.infer<typeof TimeoutBehaviorSchema>;
export type Choice = z.infer<typeof ChoiceSchema>;

// ── Helpers ──────────────────────────────────────────────────────────

export function asChoiceId(raw: string): ChoiceId {
  if (!raw.startsWith('choice_')) {
    throw new Error(`Expected choice_<id>, got '${raw}'`);
  }
  return raw as ChoiceId;
}

/**
 * Input shape for `OrchestrationStore.addChoice`. Mandatory fields the
 * caller supplies; the store fills `id`, `status`, `createdAt`,
 * `answeredAt`, `answeredOptionId`, `answeredBy`.
 */
export interface AddChoiceInput {
  kind: ChoiceKind;
  promptId: string;
  message: string;
  options: ChoiceOption[];
  recommendedOptionId?: string | null;
  safeDefaultOptionId?: string | null;
  requiresHuman: boolean;
  automationAllowed: boolean;
  timeoutBehavior?: TimeoutBehavior | null;
  consequenceIfSkipped: string;
  reversible: boolean;
  whyAsking: string;
  expiresAt?: string | null;
  resumeCommand: string[];
  linkedTaskId?: TaskId | null;
  linkedSessionId: SessionId;
}

/**
 * Allowed status transitions for a Choice.
 *
 *   pending     → answered | expired | cancelled | superseded
 *   answered    → superseded   (rare — when a later flow invalidates the
 *                                pick and asks again with a fresh promptId)
 *   expired     → superseded
 *   cancelled   → superseded
 *   superseded  → (terminal)
 */
const ALLOWED_CHOICE_TRANSITIONS: ReadonlyMap<
  ChoiceStatus,
  ReadonlySet<ChoiceStatus>
> = new Map<ChoiceStatus, ReadonlySet<ChoiceStatus>>([
  [
    ChoiceStatus.Pending,
    new Set<ChoiceStatus>([
      ChoiceStatus.Answered,
      ChoiceStatus.Expired,
      ChoiceStatus.Cancelled,
      ChoiceStatus.Superseded,
    ]),
  ],
  [ChoiceStatus.Answered, new Set<ChoiceStatus>([ChoiceStatus.Superseded])],
  [ChoiceStatus.Expired, new Set<ChoiceStatus>([ChoiceStatus.Superseded])],
  [ChoiceStatus.Cancelled, new Set<ChoiceStatus>([ChoiceStatus.Superseded])],
]);

export function canTransitionChoice(
  from: ChoiceStatus,
  to: ChoiceStatus,
): boolean {
  if (from === to) return false;
  if (from === ChoiceStatus.Superseded) return false;
  return ALLOWED_CHOICE_TRANSITIONS.get(from)?.has(to) ?? false;
}

export class IllegalChoiceTransitionError extends Error {
  readonly choiceId: string;
  readonly from: ChoiceStatus;
  readonly to: ChoiceStatus;
  constructor(choiceId: string, from: ChoiceStatus, to: ChoiceStatus) {
    super(
      `Choice ${choiceId}: illegal status transition '${from}' -> '${to}'.`,
    );
    this.name = 'IllegalChoiceTransitionError';
    this.choiceId = choiceId;
    this.from = from;
    this.to = to;
  }
}

export function assertChoiceTransition(
  choiceId: string,
  from: ChoiceStatus,
  to: ChoiceStatus,
): void {
  if (!canTransitionChoice(from, to)) {
    throw new IllegalChoiceTransitionError(choiceId, from, to);
  }
}
