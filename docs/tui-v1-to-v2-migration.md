# TUI v1 to v2 Migration Plan

> **STATUS: MIGRATION COMPLETE.** The v2 TUI is now the default and only TUI, living at `src/ui/tui/`. The `--tui-v2` flag and the old `src/ui/tui-v2/` directory have been removed. This document is retained as a historical record of the migration plan.

---

## What was done

1. **Phase 1 (Feature Parity):** All 16 v2 screens were verified to render correctly for every flow state. Slash commands, overlay stack, session checkpointing, and token refresh all work identically.

2. **Phase 2 (Flag Promotion):** The `--tui-v2` flag was made the default. The v1 TUI was deprecated.

3. **Phase 3 (v1 Removal):** The old v1 directory was removed. Bridge re-exports from v1 (`store.ts`, `router.ts`, `flows.ts`, `ink-ui.ts`) were inlined into the v2 directory as owned files.

4. **Phase 4 (Rename):** `src/ui/tui-v2/` was renamed to `src/ui/tui/`. The `--tui-v2` flag was removed from `bin.ts`. All imports and documentation were updated.

---

## What v2 added over v1

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
- [x] `src/ui/tui-v2/` renamed to `src/ui/tui/`
- [x] Old v1 `src/ui/tui/` directory removed
- [x] Bridge file re-exports inlined as owned files
- [x] All imports updated across the codebase
- [x] Documentation updated (CLAUDE.md, README.md, architecture.md, etc.)
- [ ] Consider deleting this migration doc once the history is no longer useful
- [ ] Consider renaming `tui-v2-*.md` doc files to drop the `tui-v2-` prefix if the content is still relevant
