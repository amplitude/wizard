/**
 * Manual verification checkpoints.
 *
 * A `Verification` represents a step a human (or, by extension, an outer
 * agent assisting the human) MUST perform out-of-band before the wizard
 * can proceed. Examples:
 *
 *   - "open Amplitude UI and confirm events are arriving"
 *   - "review the proposed dashboard for correctness"
 *   - "approve a pull request and verify the deploy preview"
 *
 * Distinct from `Choice`: a `Verification` is not a forced-choice between
 * pre-defined options; it's a free-form "did the side effect actually
 * happen?" check whose outcome is recorded as `passed` / `failed` /
 * `skipped`.
 *
 * Producers create verifications via `OrchestrationStore.addVerification`
 * and mark them via `markVerificationStatus`. The TUI / CLI render the
 * `whatToVerify` and `expectedBehavior` fields verbatim — keep them
 * concise.
 */
import { z } from 'zod';

import { SessionIdSchema, TaskIdSchema } from '../id-schemas';
import type { SessionId, TaskId } from '../state';

// ── Enums ────────────────────────────────────────────────────────────

export const VerificationKind = {
  EventPlanReview: 'event_plan_review',
  EventsArrivingInAmplitude: 'events_arriving_in_amplitude',
  DashboardCorrectness: 'dashboard_correctness',
  ExcalidrawFlow: 'excalidraw_flow',
  OauthBrowserLogin: 'oauth_browser_login',
  ManualPrTest: 'manual_pr_test',
  Other: 'other',
} as const;
export type VerificationKind =
  (typeof VerificationKind)[keyof typeof VerificationKind];

export const VerificationStatus = {
  Pending: 'pending',
  Passed: 'passed',
  Failed: 'failed',
  Skipped: 'skipped',
  Superseded: 'superseded',
} as const;
export type VerificationStatus =
  (typeof VerificationStatus)[keyof typeof VerificationStatus];

/**
 * "Terminal" mirrors the meaning used by `isTerminalChoiceStatus`: a status
 * with no actionable forward transitions other than re-supersede. `Failed`
 * and `Skipped` are NOT terminal here — `ALLOWED_VERIFICATION_TRANSITIONS`
 * permits `Failed → Passed` (operator re-ran and it now passes) and
 * `Skipped → Passed | Failed` (operator decided to come back to it), and
 * `last-stopping-point.ts` already treats `Failed` as actionable by
 * surfacing it in `pendingManualVerifications`.
 */
const TERMINAL_VERIFICATION_STATUSES = new Set<VerificationStatus>([
  VerificationStatus.Passed,
  VerificationStatus.Superseded,
]);

export function isTerminalVerificationStatus(s: VerificationStatus): boolean {
  return TERMINAL_VERIFICATION_STATUSES.has(s);
}

// ── Schemas ──────────────────────────────────────────────────────────

export const VerificationIdSchema = z
  .string()
  .regex(/^verif_[A-Za-z0-9_-]+$/, 'expected verif_<id>');

export const VerificationKindSchema = z.enum([
  VerificationKind.EventPlanReview,
  VerificationKind.EventsArrivingInAmplitude,
  VerificationKind.DashboardCorrectness,
  VerificationKind.ExcalidrawFlow,
  VerificationKind.OauthBrowserLogin,
  VerificationKind.ManualPrTest,
  VerificationKind.Other,
]);

export const VerificationStatusSchema = z.enum([
  VerificationStatus.Pending,
  VerificationStatus.Passed,
  VerificationStatus.Failed,
  VerificationStatus.Skipped,
  VerificationStatus.Superseded,
]);

export const VerificationSchema = z.object({
  id: VerificationIdSchema,
  kind: VerificationKindSchema,
  whatToVerify: z.string().min(1),
  /**
   * Argv array the user can paste to perform the verification (e.g.
   * `['open', 'https://app.amplitude.com/...']`). Optional — some
   * verifications are out-of-band and there's nothing to run.
   */
  commandToRun: z.array(z.string()),
  expectedBehavior: z.string().min(1),
  status: VerificationStatusSchema,
  blockingTaskId: TaskIdSchema.nullable(),
  blockingPRNumber: z.number().int().positive().nullable(),
  blockingSessionId: SessionIdSchema,
  /**
   * Optional one-liner that helps the user / outer agent decide what to
   * do if the verification fails. The TUI surfaces this verbatim under
   * the failure UI.
   */
  unblockerHint: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  resumeCommand: z.array(z.string()),
});

// ── TS types ─────────────────────────────────────────────────────────

export type VerificationId = `verif_${string}`;
export type Verification = z.infer<typeof VerificationSchema>;

export function asVerificationId(raw: string): VerificationId {
  if (!raw.startsWith('verif_')) {
    throw new Error(`Expected verif_<id>, got '${raw}'`);
  }
  return raw as VerificationId;
}

export interface AddVerificationInput {
  kind: VerificationKind;
  whatToVerify: string;
  commandToRun?: string[];
  expectedBehavior: string;
  blockingTaskId?: TaskId | null;
  blockingPRNumber?: number | null;
  blockingSessionId: SessionId;
  unblockerHint?: string | null;
  resumeCommand: string[];
}

/**
 * Allowed status transitions for a Verification.
 *
 *   pending    → passed | failed | skipped | superseded
 *   failed     → passed   (operator re-ran and it now passes)
 *   skipped    → passed | failed | superseded   (operator decided to come back to it)
 *   passed     → superseded   (a later flow invalidates the pass and asks again)
 *   superseded → (terminal)
 */
const ALLOWED_VERIFICATION_TRANSITIONS: ReadonlyMap<
  VerificationStatus,
  ReadonlySet<VerificationStatus>
> = new Map<VerificationStatus, ReadonlySet<VerificationStatus>>([
  [
    VerificationStatus.Pending,
    new Set<VerificationStatus>([
      VerificationStatus.Passed,
      VerificationStatus.Failed,
      VerificationStatus.Skipped,
      VerificationStatus.Superseded,
    ]),
  ],
  [
    VerificationStatus.Failed,
    new Set<VerificationStatus>([
      VerificationStatus.Passed,
      VerificationStatus.Superseded,
    ]),
  ],
  [
    VerificationStatus.Skipped,
    new Set<VerificationStatus>([
      VerificationStatus.Passed,
      VerificationStatus.Failed,
      VerificationStatus.Superseded,
    ]),
  ],
  [
    VerificationStatus.Passed,
    new Set<VerificationStatus>([VerificationStatus.Superseded]),
  ],
]);

export function canTransitionVerification(
  from: VerificationStatus,
  to: VerificationStatus,
): boolean {
  if (from === to) return false;
  if (from === VerificationStatus.Superseded) return false;
  return ALLOWED_VERIFICATION_TRANSITIONS.get(from)?.has(to) ?? false;
}

export class IllegalVerificationTransitionError extends Error {
  readonly verificationId: string;
  readonly from: VerificationStatus;
  readonly to: VerificationStatus;
  constructor(
    verificationId: string,
    from: VerificationStatus,
    to: VerificationStatus,
  ) {
    super(
      `Verification ${verificationId}: illegal status transition '${from}' -> '${to}'.`,
    );
    this.name = 'IllegalVerificationTransitionError';
    this.verificationId = verificationId;
    this.from = from;
    this.to = to;
  }
}

export function assertVerificationTransition(
  verificationId: string,
  from: VerificationStatus,
  to: VerificationStatus,
): void {
  if (!canTransitionVerification(from, to)) {
    throw new IllegalVerificationTransitionError(verificationId, from, to);
  }
}
