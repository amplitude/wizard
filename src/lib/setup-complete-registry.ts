/**
 * Registry for the `setup_complete` event payload.
 *
 * The wizard discovers `setup_complete` data piecemeal during a run:
 * the dashboard URL arrives from the agent's dashboard.json watcher,
 * the file-change list arrives from PostToolUse hooks, the Amplitude
 * scope arrives from credential resolution. None of those sites have
 * a clean handle on a single "wizard run object" they can mutate, so
 * this module sits between them as a tiny in-memory accumulator.
 *
 * `wizardSuccessExit` calls `consumeSetupComplete()` exactly once,
 * just before emitting `run_completed`, and forwards the payload to
 * `getUI().emitSetupComplete?.(...)`. After consume, the registry
 * resets so a re-entry (test harness, repeated runs in the same
 * process) starts clean.
 *
 * Keep this module pure — no I/O, no UI imports — so it can be
 * exercised by unit tests without standing up the full wizard.
 */

import type { SetupCompleteData } from './agent-events';

/** Mutable payload we accumulate over the course of a run. */
type Pending = Omit<SetupCompleteData, 'event'>;

let pending: Pending | null = null;

/**
 * Merge a partial `setup_complete` payload into the in-memory
 * registry. Repeated calls are additive: arrays concatenate (with
 * de-dup), object fields shallow-merge, scalars overwrite. This lets
 * three different sites (credential resolver / file-change hook /
 * dashboard watcher) each contribute the slice they own without
 * coordinating.
 */
export function registerSetupComplete(partial: Partial<Pending>): void {
  if (!pending) {
    pending = { amplitude: {} };
  }
  // amplitude — shallow merge so later resolution (e.g. envName from
  // the env picker) overrides earlier defaults from auth status.
  if (partial.amplitude) {
    pending.amplitude = { ...pending.amplitude, ...partial.amplitude };
  }
  // files / envVars — concatenate + de-dup so the registry remains
  // idempotent across repeated calls from the same hook.
  if (partial.files) {
    const written = new Set([
      ...(pending.files?.written ?? []),
      ...partial.files.written,
    ]);
    const modified = new Set([
      ...(pending.files?.modified ?? []),
      ...partial.files.modified,
    ]);
    pending.files = {
      written: [...written],
      modified: [...modified],
    };
  }
  if (partial.envVars) {
    const added = new Set([
      ...(pending.envVars?.added ?? []),
      ...partial.envVars.added,
    ]);
    const modified = new Set([
      ...(pending.envVars?.modified ?? []),
      ...partial.envVars.modified,
    ]);
    pending.envVars = {
      added: [...added],
      modified: [...modified],
    };
  }
  // events — last writer wins (the canonical event_plan_set is the
  // final approved list).
  if (partial.events) {
    pending.events = partial.events;
  }
  if (partial.durationMs !== undefined) {
    pending.durationMs = partial.durationMs;
  }
  if (partial.followups) {
    pending.followups = { ...pending.followups, ...partial.followups };
  }
}

/**
 * Read-and-clear the accumulated payload. Returns `null` when nothing
 * was registered (e.g. the wizard exited before the agent ran), so
 * the caller can skip emission entirely. Idempotent — a second call
 * after consume returns `null`.
 */
export function consumeSetupComplete(): Pending | null {
  if (!pending) return null;
  const out = pending;
  pending = null;
  return out;
}

/**
 * Discard any pending payload without emitting. Used by `wizardAbort`
 * paths so a partial setup-complete from a failed run doesn't leak
 * into the next run inside the same process (test harnesses, REPL).
 */
export function resetSetupComplete(): void {
  pending = null;
}

/**
 * Read the accumulated payload WITHOUT consuming it. Used by the
 * OutroScreen's "View files changed" view so the user can review the
 * file list before exit while leaving the registry intact for the
 * downstream `wizardSuccessExit` → `setup_complete` emission.
 *
 * Returns the live reference (not a clone) — callers must treat the
 * result as read-only. Returns `null` when nothing was registered.
 */
export function peekSetupComplete(): Readonly<Pending> | null {
  return pending;
}

/**
 * Back-compat alias for the original test-only accessor. Retained so
 * existing tests don't churn — new callers should use `peekSetupComplete`.
 */
export const _peekSetupCompleteForTests = peekSetupComplete;

/**
 * Derive a dashboard ID from a dashboard URL. Last path segment after
 * a `/dashboard/` boundary — works for current Amplitude URLs of the
 * form `https://app.amplitude.com/.../dashboard/<id>` and degrades
 * gracefully when the URL doesn't match. Pure for unit testing.
 */
export function dashboardIdFromUrl(url: string): string | undefined {
  const m = url.match(/\/dashboard\/([^/?#]+)/);
  return m ? m[1] : undefined;
}
