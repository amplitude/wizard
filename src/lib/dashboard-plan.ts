/**
 * Schema + read/write helpers for `<installDir>/.amplitude/dashboard-plan.json`.
 *
 * The dashboard-plan artifact is the persistence-side hand-off from the
 * in-loop agent (which decides what charts and dashboard to build) to a
 * deferred command that actually creates them in Amplitude once event
 * ingestion catches up. PR 2 (DEFER_DASHBOARD_PLAN.md) introduces this
 * artifact + its writer; the deferred command that consumes it lands in
 * PR 3, and PR 4 switches the main runner over.
 *
 * The artifact is intentionally additive in PR 2 — today's `record_dashboard`
 * tool still writes `dashboard.json` exactly as before. Nothing reads
 * `dashboard-plan.json` yet outside of the smoke tests.
 *
 * Path: `<installDir>/.amplitude/dashboard-plan.json` — sibling of
 * `events.json`, `project-binding.json`, and `dashboard.json`.
 *
 * Wire format is JSON; the schema is enforced via Zod so a corrupted or
 * partial file (e.g. crashed mid-write before atomicWrite landed, or
 * hand-edited) round-trips through `readDashboardPlan` as `null` rather
 * than blowing up the deferred command.
 */

import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { atomicWriteJSON } from '../utils/atomic-write.js';
import {
  ensureDir,
  getDashboardPlanFile,
  getProjectMetaDir,
} from '../utils/storage-paths.js';
import { logToFile } from '../utils/debug.js';

// Re-export so callers that already have a `dashboard-plan` import don't
// also need to reach into storage-paths for the path helper.
export { getDashboardPlanFile };

// ── Zod schema ───────────────────────────────────────────────────────────────

/**
 * Chart-type enum mirrors the shapes the `amplitude-chart-dashboard-plan`
 * skill emits today. `unknown` is included as a forward-compat slot for new
 * shapes the skill might introduce — readers should treat it as opaque.
 */
const DashboardChartTypeSchema = z.enum([
  'funnel',
  'line',
  'bar',
  'pie',
  'retention',
  'segmentation',
  'unknown',
]);

export type DashboardChartType = z.infer<typeof DashboardChartTypeSchema>;

/**
 * One event the agent decided to chart. Mirrors the `events.json` shape
 * (name + optional property list) so a deferred command can intersect the
 * plan with what's actually been instrumented when it runs.
 */
const DashboardPlanEventSchema = z
  .object({
    name: z.string().min(1),
    properties: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type DashboardPlanEvent = z.infer<typeof DashboardPlanEventSchema>;

/**
 * One chart in the plan. `eventName` is the join key back to the events
 * array; `metadata` is a future-proof slot so the schema can carry skill-
 * specific extras (e.g. groupBy filters, retention windows) without a
 * breaking change.
 */
const DashboardPlanChartSchema = z
  .object({
    title: z.string().min(1),
    eventName: z.string().min(1),
    chartType: DashboardChartTypeSchema,
    grouping: z.string().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type DashboardPlanChart = z.infer<typeof DashboardPlanChartSchema>;

/**
 * The dashboard wrapper itself. `layout` is opaque to PR 2 readers — the
 * deferred command in PR 3 picks this up.
 */
const DashboardPlanDashboardSchema = z
  .object({
    title: z.string().min(1),
    layout: z.enum(['grid', 'list']).optional(),
  })
  .strict();

export type DashboardPlanDashboard = z.infer<
  typeof DashboardPlanDashboardSchema
>;

/**
 * The full on-disk artifact. `version: 1` is hardcoded so future schema
 * shifts can be detected at read time and either migrated or rejected.
 *
 * `planId` and `createdAt` are stamped by the writer (`writeDashboardPlan`)
 * — callers cannot supply them. This keeps the artifact's identity owned
 * by the persistence layer rather than the agent that produced it.
 */
export const DashboardPlanSchema = z
  .object({
    version: z.literal(1),
    planId: z.string().min(1),
    createdAt: z.iso.datetime(),
    orgId: z.string().min(1),
    projectId: z.string().min(1),
    events: z.array(DashboardPlanEventSchema),
    charts: z.array(DashboardPlanChartSchema),
    dashboard: DashboardPlanDashboardSchema,
  })
  .strict();

export type DashboardPlan = z.infer<typeof DashboardPlanSchema>;

/**
 * Input to {@link writeDashboardPlan} — the body callers (e.g. the
 * `record_dashboard_plan` MCP tool handler) supply. Stamped fields
 * (`version`, `planId`, `createdAt`) are filled in by the writer so they
 * cannot drift.
 */
export const DashboardPlanInputSchema = DashboardPlanSchema.omit({
  version: true,
  planId: true,
  createdAt: true,
});

export type DashboardPlanInput = z.infer<typeof DashboardPlanInputSchema>;

// ── Writer ───────────────────────────────────────────────────────────────────

/**
 * Stamp + persist a dashboard plan to `<installDir>/.amplitude/dashboard-plan.json`.
 *
 * Behavior mirrors `persistEventPlan` / `persistDashboard` in `wizard-tools.ts`:
 *   - Refuses to write if `installDir` does not already exist (avoids silent
 *     creation in unexpected places due to a typo or wrong cwd).
 *   - Creates `.amplitude/` lazily.
 *   - Uses `atomicWriteJSON` so a crash mid-write leaves the prior file
 *     intact.
 *   - Returns the persisted plan on success, `null` on any I/O failure.
 *     Logging-only — the writer never throws so callers (notably the MCP
 *     tool handler) can keep their own happy path simple.
 *
 * `planId` and `createdAt` are stamped here, not by the caller, so the
 * artifact identity is owned by this module.
 */
export function writeDashboardPlan(
  installDir: string,
  input: DashboardPlanInput,
): DashboardPlan | null {
  // Validate the caller's input separately from the on-disk shape so a
  // malformed body surfaces as a Zod error before we touch the filesystem.
  const parsed = DashboardPlanInputSchema.safeParse(input);
  if (!parsed.success) {
    logToFile(
      `writeDashboardPlan: rejecting invalid input — ${parsed.error.message}`,
    );
    return null;
  }

  if (!fs.existsSync(installDir)) {
    logToFile(
      `writeDashboardPlan: working directory does not exist: ${installDir}`,
    );
    return null;
  }

  const plan: DashboardPlan = {
    version: 1,
    planId: randomUUID(),
    createdAt: new Date().toISOString(),
    ...parsed.data,
  };

  // Belt-and-suspenders — re-validate the stamped artifact so the on-disk
  // file is guaranteed to round-trip cleanly through `readDashboardPlan`.
  const finalCheck = DashboardPlanSchema.safeParse(plan);
  if (!finalCheck.success) {
    logToFile(
      `writeDashboardPlan: stamped plan failed validation — ${finalCheck.error.message}`,
    );
    return null;
  }

  try {
    ensureDir(getProjectMetaDir(installDir), 0o755);
    atomicWriteJSON(getDashboardPlanFile(installDir), plan);
    return plan;
  } catch (err) {
    logToFile(
      `writeDashboardPlan: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

// ── Reader ───────────────────────────────────────────────────────────────────

/**
 * Read the dashboard plan from `<installDir>/.amplitude/dashboard-plan.json`.
 *
 * Returns the parsed plan on success, `null` if the file is missing,
 * unreadable, or fails schema validation. The reader is tolerant by design —
 * a corrupted artifact should not crash the deferred command; it should
 * fall through to "no plan, run wizard run again."
 */
export function readDashboardPlan(installDir: string): DashboardPlan | null {
  const filePath = getDashboardPlanFile(installDir);
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      logToFile(
        `readDashboardPlan: read failed for ${filePath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return null;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    logToFile(
      `readDashboardPlan: invalid JSON in ${filePath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }

  const result = DashboardPlanSchema.safeParse(parsedJson);
  if (!result.success) {
    logToFile(
      `readDashboardPlan: schema validation failed for ${filePath}: ${result.error.message}`,
    );
    return null;
  }
  return result.data;
}
