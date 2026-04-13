# TUI Migration Record

> **STATUS: COMPLETE.** The TUI redesign is finished. The TUI lives at `src/ui/tui/`. This document is retained as a historical record.

---

## What was done

1. **Phase 1 (Feature Parity):** All 16 screens were verified to render correctly for every flow state. Slash commands, overlay stack, session checkpointing, and token refresh all work identically.

2. **Phase 2 (Flag Promotion):** The `--tui-v2` flag was made the default. The old TUI was deprecated.

3. **Phase 3 (Old TUI Removal):** The old TUI directory was removed. Bridge re-exports were inlined as owned files.

4. **Phase 4 (Rename):** The TUI was moved to `src/ui/tui/`. The `--tui-v2` flag was removed from `bin.ts`. All imports and documentation were updated.

---

## What the redesign added

- Journey stepper with step-level progress
- Keyboard hint bar (context-sensitive key hints per screen)
- Dissolve transitions between screens
- Screen error boundaries (per-screen crash recovery)
- `useAsyncEffect` hook (AbortController-based, prevents stale state writes)
- `useWizardStore` hook (eliminates subscription boilerplate)
- `withTimeout` / `withRetry` utilities for API call resilience
- `classifyError` for user-friendly network error messages
- `diagnostics` module (flow evaluation + sanitized diagnostic snapshots)
- Redesigned visual components (AmplitudeLogo, BrailleSpinner, HeaderBar)

---

## Cleanup checklist

- [x] `--tui-v2` flag removed from `bin.ts`
- [x] `AMPLITUDE_TUI_V2` env var removed
- [x] TUI moved to `src/ui/tui/`
- [x] Old TUI directory removed
- [x] Bridge file re-exports inlined as owned files
- [x] All imports updated across the codebase
- [x] Documentation updated (CLAUDE.md, README.md, architecture.md, etc.)
- [x] Doc files renamed to drop `tui-v2-` prefix
