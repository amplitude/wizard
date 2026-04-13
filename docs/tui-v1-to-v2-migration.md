# TUI v1 to v2 Migration Plan

Concrete plan for making `src/ui/tui-v2/` the only TUI and deleting `src/ui/tui/`.

---

## Current State

v2 runs in parallel behind `--tui-v2`. It re-exports three bridge files from v1:

| v2 bridge file | v1 source |
|----------------|-----------|
| `src/ui/tui-v2/store.ts` | `src/ui/tui/store.ts` |
| `src/ui/tui-v2/router.ts` | `src/ui/tui/router.ts` |
| `src/ui/tui-v2/flows.ts` | `src/ui/tui/flows.ts` |
| `src/ui/tui-v2/ink-ui.ts` | `src/ui/tui/ink-ui.ts` |

v2 owns everything else: screens, components, hooks, utils, styles, screen-registry, App.tsx, start-tui.ts, console-commands.ts.

---

## Phase 1: Feature Parity Verification (current)

### What v2 has that v1 does not
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

### What v1 has that v2 still re-exports
- `WizardStore` — full reactive state layer with 60+ mutation methods
- `WizardRouter` — flow pipeline resolution, overlay stack management
- `FLOWS` — declarative flow pipelines with `show`/`isComplete` predicates
- `InkUI` — the `WizardUI` implementation that bridges Ink rendering to the store
- `Screen`, `Flow`, `Overlay` enums
- All type exports (`ScreenName`, `OutroData`, `WizardSession`, `TaskItem`, `PlannedEvent`, `PendingPrompt`)

### Tests that must pass for both

All existing tests in `src/ui/tui/__tests__/` (router, flow-invariants, store, console-commands) must continue to pass unchanged, since v2 re-exports the same logic. Any v2-specific tests should be added in `src/ui/tui-v2/__tests__/`.

**Checklist before moving to Phase 2:**
- [ ] All 16 v2 screens render correctly for every flow state
- [ ] Slash commands work identically in v2
- [ ] Overlay stack (Outage, SettingsOverride, Snake, MCP, Slack, Logout, Login) works in v2
- [ ] Session checkpointing saves/loads correctly through v2 flows
- [ ] Token refresh fires transparently during v2 sessions
- [ ] Agent mode (`--agent`) is unaffected by the v2 flag (separate code path)
- [ ] Manual QA pass through full wizard flow with `--tui-v2`

---

## Phase 2: Feature Flag Promotion

**Goal:** `--tui-v2` becomes the default. `--tui-v1` becomes the escape hatch.

### Steps

1. **Flip the default in `bin.ts`:** Change the `tui-v2` yargs option default from `false` to `true`. Add `--tui-v1` as the opt-out flag.
2. **Update `pnpm try`:** Remove `--tui-v2` from docs/instructions since it becomes default.
3. **Add analytics tracking:** Emit an event when the user is running v1 vs v2 (for activation rate comparison).
4. **Preserve v1 as escape hatch:** `--tui-v1` forces the old TUI. Log a deprecation warning when used.

### Metrics to gate the switch

Before removing `--tui-v1`, collect 2-4 weeks of data comparing:

| Metric | Definition | Gate |
|--------|-----------|------|
| Activation rate | % of runs that reach `RunPhase.completed` | v2 >= v1 |
| Error rate | % of runs that hit `ScreenErrorBoundary` or `OutroKind.Error` | v2 <= v1 |
| Session duration | Median time from Intro to Outro | v2 <= v1 (faster is better) |
| Drop-off screen | Which screen users quit on most | No new drop-off points in v2 |

### Timeline

- Week 0: Flip default
- Weeks 1-4: Data collection period
- Week 4: Review metrics, decide go/no-go for Phase 3

---

## Phase 3: v1 Deprecation

**Goal:** Remove `--tui-v1` flag and delete `src/ui/tui/`.

### Steps

1. **Remove `--tui-v1` flag from `bin.ts`** and the conditional import logic.
2. **Inline v2 bridge re-exports:** Copy `store.ts`, `router.ts`, `flows.ts`, and `ink-ui.ts` from `src/ui/tui/` into `src/ui/tui-v2/` as owned files (not re-exports). This is the riskiest step — verify all type exports are preserved.
3. **Delete `src/ui/tui/` directory** entirely.
4. **Update all imports** across the codebase that reference `src/ui/tui/` to point to `src/ui/tui-v2/`.
5. **Update tests:** Move `src/ui/tui/__tests__/` to `src/ui/tui-v2/__tests__/` (router.test.ts, flow-invariants.test.ts, store.test.ts, console-commands.test.ts).
6. **Run full test suite** to verify nothing broke.

### Risk mitigation

- Do the inlining (step 2) in a separate commit before the deletion (step 3), so git bisect can isolate issues.
- Run the fast-check flow-invariant tests after inlining to verify all 24 property tests still pass.
- Keep a git tag (`tui-v1-last`) on the last commit before deletion for emergency rollback.

---

## Phase 4: Cleanup

**Goal:** Remove all traces of the v1/v2 split from the codebase.

### Steps

1. **Remove bridge file comments** — Delete "Re-export v1" JSDoc headers from inlined files.
2. **Rename directory:** `src/ui/tui-v2/` becomes `src/ui/tui/`. Update all imports.
3. **Update `CLAUDE.md`:** Remove the v1/v2 distinction from the Architecture section. Collapse back to a single "TUI layer" entry.
4. **Update `package.json`:** Remove any `tui-v2`-related scripts or flags.
5. **Update CI workflows:** Remove any v1-specific test matrix entries.
6. **Delete this migration doc** (`docs/tui-v1-to-v2-migration.md`) — it has served its purpose.
7. **Delete the other tui-v2 docs** (`tui-v2-critical-files.md`, `tui-v2-error-prone-code.md`, etc.) or rename them to drop the `tui-v2-` prefix if the content is still relevant.

### Final verification

- `pnpm test` passes
- `pnpm test:bdd` passes
- `pnpm build` succeeds
- `pnpm try` runs the (now only) TUI
- `pnpm try --agent` still works
- No references to `tui-v2` remain in source code (grep check)
