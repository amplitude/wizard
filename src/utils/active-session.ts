/**
 * Active-session registry — a tiny module-level slot the TUI startup
 * fills with the live `WizardSession` so process-level handlers
 * (`safety-net.ts`, signal handlers) can find the session without
 * pulling in the whole TUI module graph.
 *
 * Lives in `utils/` (not `ui/tui/`) because it must be importable from
 * very early code paths — including before the TUI mounts. Keeping it
 * standalone also avoids circular imports between safety-net and the
 * store.
 *
 * Lifetime: registered when the TUI store boots, cleared when the
 * wizard exits (best-effort). Production runs are one-shot processes
 * so a single slot is sufficient.
 */

// We type the slot as `unknown` to avoid pulling in the full
// `WizardSession` type (and its transitive imports) into modules that
// only need a best-effort handle. Consumers cast on read.
//
// We store a *getter* (not a snapshot) so the safety-net always reads
// the LIVE session at fatal time. If we stored `store.session` directly
// at registration, the user's progress accumulated after registration
// (region, org/project, framework) would be silently dropped when
// `saveCheckpoint` runs from the fatal handler.
type SessionGetter = () => unknown;
let _getActiveSession: SessionGetter | null = null;

/**
 * Register a getter for the live session. Called by the TUI startup once
 * the store is constructed. The getter is invoked every time
 * `tryGetWizardStoreSession()` is called, so the safety-net always sees
 * the user's latest progress, not the state at registration time.
 *
 * Idempotent — last write wins. Pass `null`/`undefined` to clear.
 */
export function setActiveSession(
  getter: SessionGetter | null | undefined,
): void {
  _getActiveSession = typeof getter === 'function' ? getter : null;
}

/**
 * Best-effort accessor for the active session. Returns null when no
 * session is registered (e.g. agent / CI mode, or a fatal during
 * pre-TUI bootstrap), or when the registered getter throws.
 */
export function tryGetWizardStoreSession(): unknown {
  if (!_getActiveSession) return null;
  try {
    return _getActiveSession() ?? null;
  } catch {
    // A throwing getter must not bring down the safety-net — fall back
    // to "no session" so the abort path can still run.
    return null;
  }
}

/**
 * Test-only — clear the slot between assertions. Production runs
 * exit at the end of `wizardAbort` and don't need this.
 */
export function _resetActiveSessionForTests(): void {
  _getActiveSession = null;
}
