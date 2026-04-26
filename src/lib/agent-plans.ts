/**
 * agent-plans — persistence for `amplitude-wizard plan` output.
 *
 * The wizard's plan/apply/verify command split decouples "decide what to do"
 * from "actually do it." `plan` runs detection + planning, persists a JSON
 * blob keyed by a generated `planId`, and emits a `plan` NDJSON event so an
 * outer agent (Claude Code, Cursor, custom orchestrator) can inspect what
 * the wizard intends to do _before_ any files are touched.
 *
 * `apply --plan-id <id> --yes` then re-loads the plan, validates it's still
 * fresh, and runs the actual instrumentation flow against it. This is the
 * sub-agent contract the design doc calls for: outer agent proposes →
 * human approves → wizard executes.
 *
 * Storage is a flat directory under `$TMPDIR`. Plans expire after 24 hours
 * (matching the wizard session checkpoint TTL) so stale plans don't pile up
 * across runs. All writes go through `atomicWriteJSON` to avoid corruption
 * on crash.
 *
 * Privacy: plans contain framework, SDK choice, event names, and file paths
 * relative to the install dir. They never include credentials, tokens, or
 * absolute paths outside the install dir. Outer agents see only what the
 * `plan` NDJSON event carries.
 */

import { promises as fs, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, basename } from 'path';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { atomicWriteJSON } from '../utils/atomic-write.js';
// ── Plan shape ──────────────────────────────────────────────────────

/** A single file the inner agent intends to create or modify. */
export const FileChangeSchema = z.object({
  /** Path relative to `installDir`. Never absolute, never escapes the project root. */
  path: z.string().min(1).max(512),
  operation: z.enum(['create', 'modify', 'delete']),
  reason: z.string().max(500).optional(),
});
export type FileChange = z.infer<typeof FileChangeSchema>;

/** A single event the inner agent intends to instrument. */
export const PlannedEventSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500),
});
export type PlannedEvent = z.infer<typeof PlannedEventSchema>;

export const WizardPlanSchema = z.object({
  /** Wire-format version. Bump on breaking shape changes. */
  v: z.literal(1),
  /** Stable identifier the outer agent passes to `apply --plan-id`. */
  planId: z.string().uuid(),
  /** ISO-8601 creation timestamp; used to enforce TTL. */
  createdAt: z.string(),
  /** Install directory the plan was generated against (absolute, used for re-validation). */
  installDir: z.string(),
  /** Framework integration the agent will instrument. */
  framework: z.string(),
  /** Human-readable framework name. */
  frameworkName: z.string().nullable(),
  /** SDK package the wizard will install. */
  sdk: z.string().nullable(),
  /** Events the inner agent intends to track (best-effort; may be empty pre-agent). */
  events: z.array(PlannedEventSchema).default([]),
  /** Files the inner agent intends to touch (best-effort). */
  fileChanges: z.array(FileChangeSchema).default([]),
  /**
   * Whether this plan still requires explicit approval before `apply` will
   * execute. Always `true` for now; reserved for future flows where the
   * orchestrator pre-approves a class of plans.
   */
  requiresApproval: z.literal(true).default(true),
});
export type WizardPlan = z.infer<typeof WizardPlanSchema>;

// ── Storage location ────────────────────────────────────────────────

/**
 * Plans live under `$TMPDIR/amplitude-wizard-plans/`. The directory is
 * created lazily on first write.
 */
export function getPlansDir(): string {
  return join(tmpdir(), 'amplitude-wizard-plans');
}

function ensurePlansDir(): string {
  const dir = getPlansDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

function planPath(planId: string): string {
  // Plan IDs are UUIDs we generated. Defensive: use only the basename so a
  // path-like input can't traverse outside the plans dir.
  return join(getPlansDir(), `${basename(planId)}.json`);
}

// ── TTL ─────────────────────────────────────────────────────────────

/** 24 hours, matching the session-checkpoint TTL. */
export const PLAN_TTL_MS = 24 * 60 * 60 * 1000;

export function isPlanFresh(plan: WizardPlan, now = Date.now()): boolean {
  const created = Date.parse(plan.createdAt);
  if (Number.isNaN(created)) return false;
  return now - created < PLAN_TTL_MS;
}

// ── Read / write ────────────────────────────────────────────────────

export interface CreatePlanInput {
  installDir: string;
  framework: string;
  frameworkName: string | null;
  sdk: string | null;
  events?: PlannedEvent[];
  fileChanges?: FileChange[];
}

export function createAndPersistPlan(input: CreatePlanInput): WizardPlan {
  ensurePlansDir();
  const plan: WizardPlan = {
    v: 1,
    planId: randomUUID(),
    createdAt: new Date().toISOString(),
    installDir: input.installDir,
    framework: input.framework,
    frameworkName: input.frameworkName,
    sdk: input.sdk,
    events: input.events ?? [],
    fileChanges: input.fileChanges ?? [],
    requiresApproval: true,
  };
  atomicWriteJSON(planPath(plan.planId), plan, 0o600);
  return plan;
}

export type LoadPlanResult =
  | { kind: 'ok'; plan: WizardPlan }
  | { kind: 'not_found' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'expired'; createdAt: string };

export async function loadPlan(planId: string): Promise<LoadPlanResult> {
  const path = planPath(planId);
  let raw: string;
  try {
    raw = await fs.readFile(path, 'utf8');
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return { kind: 'not_found' };
    return { kind: 'invalid', reason: err.message };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      kind: 'invalid',
      reason: `Plan file is not valid JSON: ${(e as Error).message}`,
    };
  }

  const result = WizardPlanSchema.safeParse(parsed);
  if (!result.success) {
    return {
      kind: 'invalid',
      reason: `Plan failed schema validation: ${result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    };
  }

  if (!isPlanFresh(result.data)) {
    return { kind: 'expired', createdAt: result.data.createdAt };
  }

  return { kind: 'ok', plan: result.data };
}

/** Delete plans older than the TTL. Best-effort; errors are swallowed. */
export async function pruneStalePlans(now = Date.now()): Promise<number> {
  const dir = getPlansDir();
  if (!existsSync(dir)) return 0;
  let pruned = 0;
  try {
    const entries = await fs.readdir(dir);
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const path = join(dir, entry);
      try {
        const stat = await fs.stat(path);
        if (now - stat.mtimeMs > PLAN_TTL_MS) {
          await fs.unlink(path);
          pruned++;
        }
      } catch {
        // Ignore individual file failures
      }
    }
  } catch {
    // Ignore directory read failures (race with cleanup, etc.)
  }
  return pruned;
}
