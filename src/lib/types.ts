/**
 * Shared type aliases used across `src/lib/`, `src/utils/`, and the TUI.
 *
 * The goal of this file is to give recurring shape patterns a single
 * canonical name so that callsites scattered across the codebase don't
 * each reinvent slightly different versions of the same idea (with
 * subtly different field names, drift between PRs, etc.).
 *
 * Types kept here are intentionally minimal and dependency-free — they
 * MUST NOT import from anything that might pull in a runtime side
 * effect. If you find yourself wanting to add an alias that depends on
 * a third-party type, keep it in the owning module instead.
 */

// ── Result<T, E> ─────────────────────────────────────────────────────────────
//
// A generic discriminated-union "either" type. Many modules in this repo
// hand-roll `{ ok: true; ...payload } | { ok: false; ...err }` shapes
// because we deliberately avoid throwing across async boundaries
// (`docs/engineering-patterns.md`). See e.g. `signup-or-auth.ts`,
// `install-dir.ts`, `mcp-with-fallback.ts`, `ampli-config.ts`,
// `middleware/schemas.ts`, `orchestrator-context.ts`, `project-marker.ts`.
//
// Existing modules with a rich, named error shape (e.g.
// `AmpliConfigParseResult`, `LoadOrchestratorContextResult`) intentionally
// keep their local aliases — they encode domain-specific error reasons
// in a way a fully generic `Result<T, E>` can't express without losing
// the discriminator-style ergonomics. New code that just wants
// "succeeded with X, otherwise some unknown failure" should reach for
// this shared alias rather than re-declaring the union inline.

/**
 * Success arm of a `Result<T, E>`. The `value` field carries the
 * successful payload; callers typically destructure as
 * `if (r.ok) { /* use r.value *\/ }`.
 */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/**
 * Error arm of a `Result<T, E>`. The `error` field carries whatever the
 * caller decided to put there — a plain string, an `Error`, a tagged
 * enum, a Zod error, etc. The discriminator is `ok`, not `error`, so
 * `error: undefined` is still a valid failure (the type just happens to
 * be `undefined`).
 */
export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/**
 * Discriminated-union result type. Prefer this over `T | null` /
 * `T | undefined` when the failure carries any meaningful information
 * (a reason string, an enum, a wrapped exception) — keeping the
 * payload makes call-site error handling self-documenting and removes
 * the temptation to throw across an async boundary.
 *
 * Example:
 *
 *   async function load(): Promise<Result<Config, 'not_found' | 'parse_error'>>
 *
 *   const r = await load();
 *   if (!r.ok) {
 *     logger.warn({ reason: r.error }, 'config load failed');
 *     return;
 *   }
 *   use(r.value);
 */
export type Result<T, E = string> = Ok<T> | Err<E>;

/** Convenience constructor for the success arm. */
export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

/** Convenience constructor for the failure arm. */
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

// ── Outcome string-literal unions ────────────────────────────────────────────
//
// Several modules independently re-declare the same string-literal
// union for "how did this terminate" reporting. Sharing the alias keeps
// `wizard-ui.ts`, `agent-ui.ts`, `agent-events.ts`, and
// `utils/analytics.ts` from drifting (e.g. one adds a `'timeout'`
// variant the others don't know about).
//
// `ToolCallOutcome` already lives in `agent-events.ts` — that module
// owns the canonical definition, and this file is re-exported here for
// convenience so callers don't have to know which file holds it.

/**
 * Terminal outcome of a wizard run, as reported on the lifecycle
 * `run_completed` event and the analytics `session ended` event.
 *
 *   success   — the wizard finished its happy-path flow and the
 *               process is about to exit 0.
 *   error     — something went wrong and the process is about to exit
 *               with a non-zero code (see `ExitCode`).
 *   cancelled — the user hit Ctrl-C / Esc / `/exit`, or the parent
 *               orchestrator sent SIGINT. Distinct from `error`
 *               because cancellation is not a failure — orchestrator
 *               dashboards typically color it differently.
 *
 * Owned by this file. `wizard-ui.ts`, `agent-ui.ts`,
 * `lib/agent-events.ts` (`RunCompletedData.outcome`), and
 * `utils/analytics.ts` (`Analytics.shutdown`) all consume this alias.
 */
export type RunOutcome = 'success' | 'error' | 'cancelled';
