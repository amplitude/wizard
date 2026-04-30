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
let _activeSession: unknown = null;

/**
 * Register the live session. Called by the TUI startup once the store
 * is constructed. Idempotent — last write wins.
 */
export function setActiveSession(session: unknown): void {
  _activeSession = session ?? null;
}

/**
 * Best-effort accessor for the active session. Returns null when no
 * session is registered (e.g. agent / CI mode, or a fatal during
 * pre-TUI bootstrap).
 */
export function tryGetWizardStoreSession(): unknown {
  return _activeSession;
}

/**
 * Test-only — clear the slot between assertions. Production runs
 * exit at the end of `wizardAbort` and don't need this.
 */
export function _resetActiveSessionForTests(): void {
  _activeSession = null;
}
