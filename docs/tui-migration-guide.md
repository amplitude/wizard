# TUI Migration Guide (PR #62)

> Covers the full TUI redesign: what was deleted, what replaced it, behavioral differences, and how to reconcile open branches.

---

## 1. Overview

PR #62 replaces the old TUI (`src/ui/tui-archived/`) with a redesigned TUI at `src/ui/tui/`, then deletes the archived code entirely. The net change is **55 files removed, ~9,370 lines deleted**. The new TUI was already in place at `src/ui/tui/` from prior promotion work; this PR is the final cleanup that removes the old code and the `--tui-v2` flag.

**Why:** The old TUI used a bordered box layout with a full-width colored `TitleBar`, raw `useSyncExternalStore` subscriptions, and no resilience infrastructure. The redesign introduces a borderless layout with journey stepper, braille spinner, dissolve transitions, error boundaries, retry/timeout utilities, and a proper design token system sourced from the Amplitude brand palette.

**Scope:** Only `src/ui/` is affected. No changes to `src/lib/`, `src/frameworks/`, `src/steps/`, `src/utils/`, `skills/`, or `bin.ts`.

---

## 2. What was deleted

Everything under `src/ui/tui-archived/` was removed. Organized by category:

### Core infrastructure

| File | Lines | Notes |
|------|------:|-------|
| `App.tsx` | 89 | Bordered layout with `TitleBar` inside `ConsoleView`; used raw `useSyncExternalStore` |
| `store.ts` | 835 | Identical API to new store; only diff is immutable spread fix |
| `router.ts` | 125 | Same logic as new router |
| `flows.ts` | 177 | Same flow pipelines |
| `ink-ui.ts` | 192 | Same `WizardUI` implementation |
| `start-tui.ts` | 71 | Same bootstrap; new version adds OSC color detection |
| `console-commands.ts` | 65 | Same slash commands |
| `screen-registry.tsx` | 106 | Same screen map |
| `styles.ts` | 35 | Minimal — 5 colors, 9 icons, no layout tokens |

### Screen components (16 screens)

All 16 screens were deleted. Each has an equivalent with the **same name and props** in the new TUI, but with restyled rendering.

| Screen | Old lines | New lines |
|--------|----------:|----------:|
| `IntroScreen.tsx` | 233 | 325 |
| `AuthScreen.tsx` | 415 | 468 |
| `SetupScreen.tsx` | 120 | 119 |
| `RunScreen.tsx` | 424 | 249 |
| `DataIngestionCheckScreen.tsx` | 262 | 399 |
| `ChecklistScreen.tsx` | 171 | 159 |
| `OutroScreen.tsx` | 205 | 221 |
| `McpScreen.tsx` | 317 | 327 |
| `SlackScreen.tsx` | 260 | 268 |
| `DataSetupScreen.tsx` | 113 | 127 |
| `RegionSelectScreen.tsx` | 73 | 78 |
| `ActivationOptionsScreen.tsx` | 94 | 91 |
| `LoginScreen.tsx` | 119 | 123 |
| `LogoutScreen.tsx` | 60 | 68 |
| `OutageScreen.tsx` | 55 | 53 |
| `SettingsOverrideScreen.tsx` | 97 | 99 |

### Shell components

| Old component | Lines | Replacement |
|---------------|------:|-------------|
| `TitleBar.tsx` | 69 | Replaced by `HeaderBar.tsx` (40 lines) — no version number, no colored background |
| `AmplitudeLogo.tsx` | 112 | Preserved identically |
| `AmplitudeTextLogo.tsx` | 53 | Preserved identically |
| `ConsoleView.tsx` | 419 | Rewritten (437 lines) — integrated `KeyHintBar` |
| `amplilogo.txt` | 8 | Removed (logo inlined) |
| *(none)* | — | **Added:** `JourneyStepper.tsx` (132 lines), `KeyHintBar.tsx` (47 lines), `BrailleSpinner.tsx` (27 lines) |

### Primitives (13 files)

All 13 primitives are **byte-for-byte identical** between old and new. No changes needed.

`CardLayout`, `ConfirmationInput`, `DissolveTransition`, `EventPlanViewer`, `LoadingBox`, `LogViewer`, `PickerMenu`, `ProgressList`, `PromptLabel`, `ReportViewer`, `ScreenErrorBoundary`, `SlashCommandInput`, `SnakeGame`, `SplitView`, `TabContainer`, `index.ts`

### Test suites (4 files, ~2,379 lines)

| Test file | Lines |
|-----------|------:|
| `store.test.ts` | 959 |
| `flow-invariants.test.ts` | 660 |
| `router.test.ts` | 643 |
| `console-commands.test.ts` | 117 |

All four exist identically in the new TUI at `src/ui/tui/__tests__/`.

### Hooks, services, context

| File | Lines | Status in new TUI |
|------|------:|-------------------|
| `hooks/useScreenInput.ts` | 26 | Preserved identically |
| `hooks/useStdoutDimensions.ts` | 36 | Preserved identically |
| `context/CommandModeContext.ts` | 4 | Preserved identically |
| `services/mcp-installer.ts` | 128 | Preserved identically |
| `package.json` | 1 | Preserved identically |

---

## 3. Behavioral differences (old → new)

| Area | Old TUI (`tui-archived`) | New TUI (`tui`) |
|------|--------------------------|-----------------|
| **Header** | Full-width blue `TitleBar` with version number and feedback email | Minimal `HeaderBar` — "Amplitude Wizard" left, org/project right, no version (moved to `/whoami`) |
| **Progress indication** | None — no visual flow progress | `JourneyStepper` — 1-line step indicator: `✓ Welcome ✓ Auth ● Setup ○ Verify ○ Done` |
| **Keyboard hints** | None | `KeyHintBar` — context-sensitive per-screen key hints |
| **Layout** | Bordered box, content inside `ConsoleView` border | Borderless, full-width with separator lines, content outside border chrome |
| **Width** | `MIN_WIDTH=80`, `MAX_WIDTH=120`, hardcoded | `Layout.minWidth=60`, `Layout.maxWidth=120`, centralized in design tokens |
| **Spinner** | None (or framework-specific) | `BrailleSpinner` — 10-frame braille animation at 80ms interval |
| **Design tokens** | 5 color constants (`primary`, `accent`, `success`, `error`, `muted`), 9 icon glyphs | Full brand palette (13 grays, 7 accent colors), semantic aliases (4 text levels, status, surfaces), 18 icon glyphs, layout constants |
| **Store subscription** | Raw `useSyncExternalStore` in every component | `useWizardStore` hook — single import, eliminates subscription boilerplate |
| **Async effects** | Ad-hoc cleanup patterns | `useAsyncEffect` hook — AbortController-based, prevents stale state writes |
| **Error handling** | `ScreenErrorBoundary` only | `ScreenErrorBoundary` + `classifyError` utility for user-friendly network error messages |
| **Transitions** | `DissolveTransition` (identical) | `DissolveTransition` (identical) with directional awareness via `lastNavDirection` |
| **Resilience** | None | `withTimeout`, `withRetry` utilities for API call resilience |
| **Diagnostics** | None | `diagnostics` module — flow evaluation snapshots, sanitized state dumps |
| **Vendor branding** | References to "Claude" in some screens | Genericized to "AI" — no vendor-specific model references |
| **TEST_PROMPT** | Supported in old screens | Removed |
| **Crash recovery** | None | Session checkpoint (`session-checkpoint.ts`) — saves/loads state to temp file, 24-hour TTL |
| **Token refresh** | Full browser re-auth on expiry | Silent refresh via `token-refresh.ts` — proactive refresh 5 min before expiry |

---

## 4. What is preserved (unchanged)

These items are identical between old and new and require zero migration effort:

- **All 13 primitives** — `CardLayout`, `ConfirmationInput`, `DissolveTransition`, `EventPlanViewer`, `LoadingBox`, `LogViewer`, `PickerMenu`, `ProgressList`, `PromptLabel`, `ReportViewer`, `ScreenErrorBoundary`, `SlashCommandInput`, `SnakeGame`, `SplitView`, `TabContainer`
- **Store API shape** — `WizardStore` class has the same public interface; all getters, setters, and event names are identical
- **Router and flow logic** — `WizardRouter`, `Screen` enum, `Overlay` enum, `Flow` enum, `FlowEntry` type, `FLOWS` pipelines are all identical
- **Screen names and props** — all 16 screens keep the same component names and prop interfaces
- **Slash commands** — `/org`, `/project`, `/region`, `/login`, `/logout`, `/whoami`, `/chart`, `/dashboard`, `/taxonomy`, `/slack`, `/feedback`, `/help` all work the same
- **All framework integrations** — `src/frameworks/` is completely untouched
- **Core business logic** — `src/lib/` is completely untouched
- **Agent mode** — `AgentUI` / NDJSON mode is unaffected
- **Test coverage** — all 4 test suites preserved with identical assertions

---

## 5. Reconciling open branches

If you have an open branch that touches TUI code, here is how to rebase onto this PR.

### Branches touching screens

**Impact: medium.** Screen component names and prop interfaces are unchanged, but the rendering internals are restyled. Expect merge conflicts in JSX markup and color references.

- Rebase onto `kelsonpw/tui-v2-pipeline`
- Your screen logic (store reads, effect hooks, state transitions) will merge cleanly
- Your JSX will conflict where styling changed — resolve by adopting the new `Colors.*` / `Icons.*` tokens from `styles.ts`
- Replace any `Colors.primary` usage with `Colors.accent` or the appropriate semantic alias

### Branches touching store

**Impact: low.** The store API is identical. The only meaningful diff is an immutable spread fix in internal state mutations.

- Rebase normally; conflicts will be trivial
- If you added new store methods, they will merge cleanly since the class shape is the same

### Branches touching router or flows

**Impact: low.** The router and flow pipelines are logic-identical. The files were re-exported through `router.ts` rather than inlined, but the types and runtime behavior are the same.

- Rebase normally; conflicts are unlikely

### Branches touching primitives

**Impact: none.** Primitives are byte-for-byte identical. No conflicts possible.

### Branches touching `src/lib/`

**Impact: none.** This PR does not modify any file under `src/lib/`.

### Branches touching `bin.ts`

**Impact: low.** The `--tui-v2` flag was removed and `--agent` flag was added in prior commits. If your branch modifies yargs command definitions, check for the removed flag.

### General advice

1. `git rebase kelsonpw/tui-v2-pipeline` (or `main` after merge)
2. Most conflicts will be in screen files — accept the new styling, re-apply your logic changes
3. Replace old `Colors.*` references with the new semantic tokens
4. Replace `useSyncExternalStore` calls with `useWizardStore(store)` if you added new components
5. If you referenced `TitleBar`, switch to `HeaderBar` (different props — no `version`)
6. If you imported from `src/ui/tui-archived/`, update imports to `src/ui/tui/`

---

## 6. New infrastructure added

These files exist in the new TUI but had no equivalent in the old one:

| File | Lines | Purpose |
|------|------:|---------|
| `components/JourneyStepper.tsx` | 132 | Persistent 1-line progress indicator showing flow position |
| `components/KeyHintBar.tsx` | 47 | Context-sensitive keyboard shortcut hints per screen |
| `components/BrailleSpinner.tsx` | 27 | 10-frame braille dot spinner animation |
| `components/HeaderBar.tsx` | 40 | Minimal header replacing the old full-width `TitleBar` |
| `hooks/useWizardStore.ts` | 17 | Eliminates `useSyncExternalStore` boilerplate for store subscriptions |
| `hooks/useAsyncEffect.ts` | 40 | AbortController-based async effect hook preventing stale writes |
| `utils/withTimeout.ts` | 29 | Promise timeout wrapper for API calls |
| `utils/withRetry.ts` | 42 | Exponential backoff retry wrapper |
| `utils/classifyError.ts` | 105 | Classifies errors into user-friendly categories (network, auth, timeout, etc.) |
| `utils/diagnostics.ts` | 95 | Flow evaluation snapshots and sanitized state dumps for debugging |
| `styles.ts` (rewrite) | 136 | Full Amplitude brand palette, semantic color aliases, layout constants (was 35 lines) |

Additionally, these infrastructure pieces were added elsewhere in the codebase as part of the broader redesign effort (not deleted by this PR, but worth knowing about):

- **Session checkpoint** (`src/lib/session-checkpoint.ts`) — crash-safe state persistence to temp file, Zod-validated, 24-hour TTL
- **Silent token refresh** (`src/utils/token-refresh.ts`) — proactive OAuth refresh 5 min before expiry
- **Atomic file writes** (`src/utils/atomic-write.ts`) — temp-file + rename for crash-safe JSON persistence
- **AgentUI** (`src/ui/agent-ui.ts`) — NDJSON `WizardUI` implementation for `--agent` mode
- **ModeConfig** (`src/lib/mode-config.ts`) — `resolveMode()` for determining execution mode from CLI flags and TTY state
- **ExitCode enum** (`src/lib/exit-codes.ts`) — structured exit codes (0 success through 130 cancelled)
