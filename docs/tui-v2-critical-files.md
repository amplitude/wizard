# TUI v2: Critical Files Ranked

Ranked by blast radius — what breaks and how many users are affected if this file has a bug.

---

## Tier 1: System-Breaking (Entire wizard non-functional)

### 1. `src/ui/tui/store.ts` (shared, re-exported by v2)

**Why #1:** Single source of truth for all reactive state. Every component subscribes via `useSyncExternalStore`. If the store's `subscribe`/`getSnapshot`/`emitChange` cycle breaks, the entire UI freezes — no screen transitions, no input handling, no progress updates.

**What breaks:** Everything. The store owns session state, router, tasks, prompts, screen errors, command mode, overlays, and all 60+ mutation methods that screens depend on.

**Risk factors:**
- The `$version` atom is the sole trigger for React re-renders. If `emitChange()` fails to increment it, UI goes stale.
- `_detectTransition()` fires analytics and enter-screen hooks. A thrown error here halts all state propagation.
- Promise-based blocking (`setupComplete`, `waitForRetry`, `waitForPreDetectedChoice`) can deadlock if resolvers are never called.

---

### 2. `bin.ts` (initialization chain)

**Why #2:** The 1200-line entry point that wires everything together. OAuth, framework detection, credential pre-population, and TUI startup all happen here. A bug in bin.ts means the wizard never starts or starts with corrupt state.

**What breaks:** Pre-populated credentials, framework detection results, region selection, the `--tui-v2` conditional import, and the `setupComplete` promise that gates agent execution.

**Risk factors:**
- Dynamic imports (`await import(tuiModule)`) mean v1/v2 switching is a string comparison — typos cause silent failure.
- 4 separate `startTUI` import sites must stay in sync.
- Concurrent OAuth + framework detection creates timing hazards (see error-prone doc).

---

### 3. `src/ui/tui/router.ts` (shared)

**Why #3:** Determines which screen the user sees. The `resolve()` method walks the flow pipeline on every render. A bug here means wrong screens show, screens get skipped, or the wizard gets stuck.

**What breaks:** Screen resolution, overlay stack, navigation direction for transitions.

**Risk factors:**
- Cancel check (`outroData?.kind === OutroKind.Cancel`) short-circuits the entire flow to Outro. If set accidentally, all remaining screens are skipped.
- Overlay stack is a simple array with `push`/`pop` — no guards against duplicate pushes or empty pops.

---

### 4. `src/ui/tui/flows.ts` (shared)

**Why #4:** The `show` and `isComplete` predicates on each `FlowEntry` control the entire wizard progression. A wrong predicate means screens show when they shouldn't, or screens get skipped.

**What breaks:** The order and visibility of all 13 wizard screens.

**Risk factors:**
- Predicates read from session state that may not be set yet (e.g., `frameworkConfig` is null during detection).
- The `needsSetup()` helper reads `frameworkContext` keys — if a framework config changes its question keys, the predicate silently breaks.

---

### 5. `src/ui/tui-v2/App.tsx`

**Why #5:** Root component that orchestrates all v2 rendering. Owns the layout, screen resolution from registry, `DissolveTransition`, and `ScreenErrorBoundary`. If App.tsx crashes, the terminal goes blank.

**What breaks:** JourneyStepper, HeaderBar, content area, ConsoleView, and all screen rendering.

**Risk factors:**
- `createScreens()` is called in `useMemo` — if any screen constructor throws, the entire registry fails.
- `contentHeight` calculation depends on terminal rows; edge cases with very short terminals (<8 rows) can produce negative heights.

---

## Tier 2: Feature-Breaking (Specific flow broken, workarounds exist)

### 6. `src/ui/tui-v2/screens/AuthScreen.tsx`

**Why:** The credential gatekeeper. Until credentials are set, no downstream screen works. Has the most complex async logic in the codebase: 5-step resolution chain (OAuth wait → org pick → workspace pick → env pick → API key).

**What breaks:** Authentication, org/workspace selection, API key resolution.

---

### 7. `src/ui/tui-v2/components/ConsoleView.tsx`

**Why:** Manages slash commands, AI queries, pending prompts (confirm/choice/event-plan), error banners, and the keyboard input router. The mode-switching logic (dormant → slash → query → feedback) is the most stateful component.

**What breaks:** All user input, slash commands, AI queries, event plan approval.

---

### 8. `src/ui/tui-v2/screens/RunScreen.tsx`

**Why:** The screen users spend the most time on. Displays real-time progress, elapsed timer, current file indicator, and inline event plan. Timer and file extraction have edge cases (see error-prone doc).

**What breaks:** Agent progress visibility, elapsed time tracking, task completion display.

---

### 9. `src/ui/tui-v2/screens/DataIngestionCheckScreen.tsx`

**Why:** Polling screen that gates advancement to Checklist. If polling breaks or never resolves, the user is stuck. Has both automatic (API polling) and manual (Enter key) confirmation paths.

**What breaks:** Event verification, flow advancement post-agent-run.

---

### 10. `src/ui/tui-v2/screen-registry.tsx`

**Why:** Factory that maps all 23 screen/overlay names to React components. If any import fails or a screen constructor throws, the entire registry returns incomplete.

**What breaks:** Any individual screen or overlay rendering.

---

## Tier 3: UX-Degrading (Wrong info shown, but wizard still works)

### 11. `src/ui/tui-v2/components/JourneyStepper.tsx`

Incorrect progress indication if `STEP_SCREENS` mapping is incomplete. Doesn't break flow, but confuses users.

### 12. `src/ui/tui-v2/styles.ts`

Design tokens affect all visual presentation. Wrong colors don't break functionality but degrade the brand experience.

### 13. `src/ui/tui-v2/components/KeyHintBar.tsx`

Wrong hints don't break the wizard but cause users to press wrong keys.

### 14. `src/ui/tui-v2/components/HeaderBar.tsx`

Cosmetic. Truncation of long org/project names is the main edge case.

### 15. `src/ui/tui-v2/start-tui.ts`

Entry point. If OSC terminal color codes fail on an unsupported terminal, colors are wrong but wizard still works.

---

## Tier 4: Infrastructure (Not user-facing, but affects reliability)

### 16. `src/lib/session-checkpoint.ts`

Session checkpointing for crash recovery. Saves sanitized wizard state (no credentials) to a temp file. Zod-validated on load, 24-hour TTL, scoped per install directory. If this breaks, users lose resume-on-crash capability but the wizard still works from scratch.

**Risk factors:**
- Zod schema must stay in sync with `WizardSession` — adding a new session field without updating `CheckpointSchema` silently drops it from checkpoints.
- `atomicWriteJSON` uses PID-suffixed temp files; concurrent wizard instances could collide if PIDs wrap.

### 17. `src/utils/token-refresh.ts`

Silent OAuth token refresh. Exchanges expired access tokens for new ones using stored refresh tokens. Falls back to full browser auth on any failure.

**Risk factors:**
- 5-minute expiry buffer (`EXPIRY_BUFFER_MS`) means token can expire if a long agent run takes more than 5 minutes between refresh check and actual use.
- Zone settings (`AMPLITUDE_ZONE_SETTINGS`) must have correct `oAuthHost` and `oAuthClientId` per region.

### 18. `src/utils/atomic-write.ts`

Crash-safe file writes. Used by checkpointing and config persistence. If this breaks, config files can corrupt on crash.

**Risk factors:**
- `renameSync` is atomic on POSIX but relies on same-filesystem for temp and target. Cross-mount scenarios (unlikely for tmpdir) would fail.

### 19. `src/ui/agent-ui.ts`

NDJSON `WizardUI` for `--agent` mode. Every method emits structured JSON to stdout. Auto-approves all prompts. If this breaks, agent mode is unusable but TUI and CI modes are unaffected.

**Risk factors:**
- Security: stack traces are intentionally redacted from `setRunError` output. If someone adds a new error-emitting method, they must maintain this invariant.
- `emit()` writes directly to `process.stdout` — if stdout is piped to a closed FD, the process crashes with EPIPE.
