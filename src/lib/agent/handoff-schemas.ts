/**
 * Handoff schemas for the three-phase agent pipeline (Bet 2).
 *
 *   Planner (Sonnet, no writes)    ─WizardPlan───►  Integrator (Sonnet)
 *   Integrator (Sonnet, per-plan   ─IntegrationReport─►  Instrumenter (Haiku)
 *     allowlist, calls
 *     confirm_event_plan)
 *   Instrumenter (Haiku, subagents  ─InstrumentationReport─►  (final outcome)
 *     per feature)
 *
 * Handoffs are validated JSON, not conversation history. The next phase gets
 * a clean context with only the fields it needs, which bounds token cost and
 * makes failures localized + testable.
 *
 * Schemas are permissive where stable semantics aren't locked in yet, strict
 * where a downstream phase depends on the field (e.g., `chosenSkillId` must
 * be a non-empty string because the Integrator uses it to build its
 * per-run allowlist).
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// Planner → Integrator
// ─────────────────────────────────────────────────────────────

export const SDK_VARIANTS = [
  'browser',
  'node',
  'react',
  'vue',
  'other',
] as const;
export type SdkVariant = (typeof SDK_VARIANTS)[number];

/** An event the Planner predicts the user will want instrumented. */
export const PlannedEventSchema = z.object({
  /** Short lowercase label (2–5 words). Matches confirm_event_plan. */
  name: z.string().min(1).max(50),
  /** Full description — when it fires, properties, file paths. */
  description: z.string().min(1),
});
export type PlannedEvent = z.infer<typeof PlannedEventSchema>;

export const WizardPlanSchema = z.object({
  /** Schema tag so readers can detect drift. */
  schema: z.literal('amplitude-wizard-plan/1'),
  /** Framework integration (matches Integration enum values). */
  integration: z.string().min(1),
  /** Skill id the Planner chose from the integration category. */
  chosenSkillId: z.string().min(1),
  sdkVariant: z.enum(SDK_VARIANTS),
  /** Env var names the Integrator will set (exact uppercase identifiers). */
  envVarNames: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).min(1),
  /** Files the Integrator is allowed to Write / Edit. Used to build the
   * per-run tool-input allowlist. Relative to installDir. */
  targetFiles: z.array(z.string().min(1)).min(1),
  /** Events the Instrumenter will propose via confirm_event_plan. */
  predictedEvents: z.array(PlannedEventSchema).min(0),
  /** Optional free-form notes for downstream phases. */
  notes: z.string().optional(),
});
export type WizardPlan = z.infer<typeof WizardPlanSchema>;

// ─────────────────────────────────────────────────────────────
// Integrator → Instrumenter
// ─────────────────────────────────────────────────────────────

export const IntegrationReportSchema = z.object({
  schema: z.literal('amplitude-wizard-integration/1'),
  /** Echo of the plan's chosenSkillId so readers can correlate. */
  chosenSkillId: z.string().min(1),
  /** Files actually modified (subset of WizardPlan.targetFiles). */
  modifiedFiles: z.array(z.string().min(1)),
  /** Env vars that were set (subset of WizardPlan.envVarNames). */
  envVarsSet: z.array(z.string()),
  /** Whether confirm_event_plan was invoked + approved. Instrumenter must
   * refuse to run if this is false. */
  eventPlanConfirmed: z.boolean(),
  /** Events approved in the plan — this is the working set for the
   * Instrumenter. */
  approvedEvents: z.array(PlannedEventSchema),
  /** Any issues the Integrator wants the Instrumenter aware of. */
  warnings: z.array(z.string()).default([]),
});
export type IntegrationReport = z.infer<typeof IntegrationReportSchema>;

// ─────────────────────────────────────────────────────────────
// Instrumenter → (final outcome)
// ─────────────────────────────────────────────────────────────

/** One instrumentation entry: which event was wired into which files. */
export const InstrumentedEventSchema = z.object({
  name: z.string().min(1),
  files: z.array(z.string().min(1)).min(1),
});
export type InstrumentedEvent = z.infer<typeof InstrumentedEventSchema>;

export const InstrumentationReportSchema = z.object({
  schema: z.literal('amplitude-wizard-instrumentation/1'),
  /** Events the Instrumenter actually wired. */
  instrumentedEvents: z.array(InstrumentedEventSchema),
  /** Events the Instrumenter skipped, with reasons. */
  skippedEvents: z
    .array(z.object({ name: z.string(), reason: z.string() }))
    .default([]),
  /** Whether a dashboard was created. Dashboard is a first-class deliverable
   * per the commandments, so false here should trigger a warning. */
  dashboardCreated: z.boolean(),
  /** Optional dashboard URL (set when dashboardCreated=true). */
  dashboardUrl: z.string().url().nullable().optional(),
});
export type InstrumentationReport = z.infer<typeof InstrumentationReportSchema>;

// ─────────────────────────────────────────────────────────────
// Phase label — stable across the pipeline so `agent completed` events,
// logs, and eval-harness assertions can key on it.
// ─────────────────────────────────────────────────────────────

export const AGENT_PHASES = [
  'monolithic',
  'planner',
  'integrator',
  'instrumenter',
] as const;
export type AgentPhase = (typeof AGENT_PHASES)[number];

// ─────────────────────────────────────────────────────────────
// Parse helpers with consistent error shape
// ─────────────────────────────────────────────────────────────

export interface HandoffParseFailure {
  ok: false;
  /** Short label for the phase being parsed. */
  phase: Exclude<AgentPhase, 'monolithic'>;
  /** Zod error paths joined into a human-readable string. */
  issues: string[];
}

export interface HandoffParseSuccess<T> {
  ok: true;
  value: T;
}

export type HandoffParseResult<T> =
  | HandoffParseSuccess<T>
  | HandoffParseFailure;

function parseWith<T extends z.ZodTypeAny>(
  schema: T,
  phase: Exclude<AgentPhase, 'monolithic'>,
  input: unknown,
): HandoffParseResult<z.infer<T>> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    phase,
    issues: result.error.issues.map(
      (i) => `${i.path.join('.') || '<root>'}: ${i.message}`,
    ),
  };
}

/** Parse the Planner's output. Strict — the Integrator needs every field. */
export function parseWizardPlan(
  input: unknown,
): HandoffParseResult<WizardPlan> {
  return parseWith(WizardPlanSchema, 'planner', input);
}

/** Parse the Integrator's output. */
export function parseIntegrationReport(
  input: unknown,
): HandoffParseResult<IntegrationReport> {
  return parseWith(IntegrationReportSchema, 'integrator', input);
}

/** Parse the Instrumenter's output. */
export function parseInstrumentationReport(
  input: unknown,
): HandoffParseResult<InstrumentationReport> {
  return parseWith(InstrumentationReportSchema, 'instrumenter', input);
}
