# Amplitude Wizard — UX Improvement Recommendations

Findings from a hands-on audit of the TUI, CI mode, all 16 screens, 15+ primitives,
the store, router, flows, and console commands. Organized by priority.

---

## Table of contents

- [P0 — Bugs and broken states](#p0--bugs-and-broken-states)
- [P1 — High-impact UX wins](#p1--high-impact-ux-wins)
- [P2 — Polish and consistency](#p2--polish-and-consistency)
- [P3 — Nice to have](#p3--nice-to-have)
- [Per-screen findings](#per-screen-findings)
- [Per-primitive findings](#per-primitive-findings)
- [CI mode findings](#ci-mode-findings)
- [Infrastructure findings](#infrastructure-findings)

---

## P0 — Bugs and broken states

### 1. Store race condition in `setOrgAndProject()`

**File:** `src/ui/tui/store.ts` (around line 496)

The method fires `emitChange()` immediately but writes `ampli.json` in a
fire-and-forget `void import(…).then(…)`. If the wizard crashes before the
import/write resolves, `ampli.json` is missing but session claims success.

**Fix:** Await the import and write before calling `emitChange()`, or at minimum
queue the write and mark a "pending write" flag the session can check.

### 2. `Screen.Options` registered as `null`

**File:** `src/ui/tui/screen-registry.tsx:82`

```tsx
[Screen.Options]: null,
```

If the router ever resolves to `Screen.Options`, the TUI renders blank content
with no error. Either remove the enum value and the registry entry, or implement
the screen.

### 3. `setTimeout` leak in `setCommandFeedback()`

**File:** `src/ui/tui/store.ts` (around line 410)

Calling `setCommandFeedback()` repeatedly queues unbounded `setTimeout` handles.
No previous timeout is cleared.

**Fix:** Store the timeout ID; clear it before setting a new one.

### 4. Terminal color restoration incomplete

**File:** `src/ui/tui/start-tui.ts`

- `process.on('exit', cleanup)` doesn't fire on SIGTERM, SIGHUP, or uncaught
  exceptions. Users left with a black terminal background.
- OSC 10/11 sequences are written without checking `process.stdout.isTTY`.
  Piped output (e.g., `amplitude-wizard 2>&1 | tee log.txt`) gets raw escape
  codes in the file.
- `BG_BLACK` (SGR) and `OSC_BG_DARK` (OSC 11) both set the background. Some
  terminals get confused by the double-specification.

**Fix:**
1. Add SIGINT/SIGTERM/SIGHUP handlers that call `cleanup()`.
2. Guard all ANSI writes behind `process.stdout.isTTY`.
3. Use either SGR or OSC, not both.

### 5. Orphaned promise in `showSettingsOverride()`

**File:** `src/ui/tui/store.ts` (around line 530)

Returns a `new Promise` that resolves only when the overlay is dismissed. If the
user closes the terminal, the promise never resolves and the caller hangs
indefinitely.

**Fix:** Add an AbortSignal or resolve on process exit.

---

## P1 — High-impact UX wins

### 6. No global help overlay

There is no way for users to discover available keyboard shortcuts or slash
commands without trial and error. The slash command list only appears after
typing `/`.

**Recommendation:** Add a `?` key binding that shows a help overlay listing:
- All slash commands with descriptions
- Available keyboard shortcuts for the current screen
- How to navigate tabs, scroll logs, etc.

### 7. Silent failures everywhere

Many screens catch API errors and fall back silently:

| Screen | Silent failure |
|--------|---------------|
| DataSetupScreen | API activation check fails → falls back to local detection with no message |
| McpScreen | `installer.install()` throws → shows "skipped" without explaining why |
| SlackScreen | `opn()` fails → user sees "Opening browser..." but nothing opens |
| AuthScreen | Org/project API calls fail → no retry, no message |
| ChecklistScreen | `opn()` fails → marks item complete anyway |

**Recommendation:** Every API or external call should have a visible fallback
message: "Couldn't reach [service]. [What we did instead / what you can do]."

### 8. Auto-selection without confirmation

AuthScreen auto-selects when there's a single org, single project, or single
environment. The user is never told which was selected — they just advance.

**Problem:** If the user is in the wrong org (e.g., personal vs company), they
won't notice until much later.

**Recommendation:** Show a brief flash: "Using org: **Acme Corp** (only one
available)" with a 1.5s delay or "press any key to continue" so the selection
is visible.

### 9. No progress indicator in multi-step flows

SetupScreen asks framework disambiguation questions one at a time but shows no
progress ("Question 1 of 3"). Users don't know how many questions remain.

DataIngestionCheckScreen polls every 30 seconds but shows no heartbeat between
polls. The screen feels frozen.

**Recommendation:**
- SetupScreen: Show "Step N of M" above each question.
- DataIngestionCheckScreen: Show a subtle "Checking..." pulse every 10 seconds,
  not just every 30.

### 10. Disabled checklist items are confusing

ChecklistScreen disables the "Create dashboard" option until a chart is created,
with a hint "create a chart first". But the hint is only visible in the picker
item — users scanning the list may not notice.

**Recommendation:** Show the explanation above the picker, not buried in a hint:
"Dashboard creation unlocks after you create your first chart."

### 11. CI mode: carriage returns corrupt non-TTY logs

**File:** `src/ui/logging-ui.ts:64,74`

The spinner uses `\r` to overwrite lines in-place. In non-TTY environments
(GitHub Actions, CI log aggregators), this produces corrupted output like:

```
◌  Installing SDK...●  Installing SDK...done
```

**Fix:** Check `process.stdout.isTTY`. In non-TTY mode, use newlines instead of
carriage returns:

```
◌  Installing SDK...
●  Installing SDK... done
```

### 12. Error outro is too sparse

OutroScreen in error/cancel states shows the error message and exits on any
keystroke. No recovery guidance, no log file path, no link to docs.

**Recommendation:**
- Show the log file path (per-project, e.g. `~/.amplitude/wizard/runs/<hash>/log.txt` — invoke `/diagnostics` for the exact path)
- Show the docs URL: "Manual setup: [docsUrl]"
- Suggest retry: "Run `amplitude-wizard` again to retry"

---

## P2 — Polish and consistency

### 13. Inconsistent keyboard navigation patterns

| Component | Up/Down | Left/Right | Enter |
|-----------|---------|------------|-------|
| PickerMenu | Navigate items | Navigate columns | Select |
| ConfirmationInput | — | Toggle Continue/Cancel | Submit |
| TabContainer | — | Switch tabs | — |
| ReportViewer | Scroll | — | — |
| LogViewer | Scroll | — | — |

Up/Down means "navigate" in PickerMenu but "scroll" in viewers. Left/Right
means "columns" in PickerMenu but "toggle" in ConfirmationInput. This creates
a learning curve.

**Recommendation:** Document patterns:
- Up/Down = navigate or scroll (context-dependent)
- Left/Right = switch tabs/options
- Enter = confirm
- Escape = back/cancel

Show this in the `?` help overlay.

### 14. Inconsistent terminology

**Resolved:** The wizard now uses the Amplitude website hierarchy
**Org → Project → Environment → App** everywhere in user-facing UI, session
fields, ampli.json keys, and analytics. The Data API GraphQL schema still
exposes the legacy field `workspaces`, so adapter code maps it to `projects`
at the TS boundary — backend contracts are unchanged.

Historical notes:

- Session field `selectedProjectName` (env name) was renamed to
  `selectedEnvName` earlier to match the Data API's actual env shape, freeing
  up `selectedProjectName` for the newly renamed project layer.
- `selectedWorkspaceId/Name` → `selectedProjectId/Name`.
- `AmplitudeOrg.workspaces` → `AmplitudeOrg.projects` (TS-only rename).
- ampli.json `WorkspaceId` → `ProjectId` (legacy files auto-migrate on read).
- `--env` CLI flag remains deprecated — redundant with `--project-id` since
  each `app.id` identifies exactly one environment.

### 15. Number key shortcuts in PickerMenu not discoverable

PickerMenu supports pressing 1-9 and 0 for quick selection, but there's no
visible hint that this works. Users who discover it love it; most never will.

**Recommendation:** Show subtle `[1]`, `[2]`, etc. labels next to items
(already done in the code, but verify they render with sufficient contrast).

### 16. No back navigation

No screen supports going back to a previous step. Once you answer a SetupScreen
question, you can't reconsider. Once you select a region, you can't change it
(without the `/region` slash command, which is not documented on-screen).

**Recommendation:** At minimum, show "Press / for commands" on every screen so
users know they can use slash commands to change settings.

### 17. SlackScreen is overly verbose

The flow is: confirm → open browser → wait → confirm connection. Two
confirmations for a single action feels bureaucratic.

**Recommendation:** Collapse to one step: "Connect Amplitude to Slack? (opens
browser)" → Y → open → "Connected? Y/N"

### 18. ActivationOptionsScreen copy issues

- "Your SDK is installed waiting for events" — missing punctuation
- "I'm blocked" as a menu option is vague
- "Debug with Claude" doesn't explain what it does

**Recommendation:** Rewrite options:
1. "Run a local test to verify events are flowing"
2. "Troubleshoot with Claude (opens AI chat)"
3. "Open the Amplitude docs"
4. "Exit for now"

### 19. McpScreen: pre-detected choice is confusing

When Amplitude is already detected in the project, McpScreen shows:
- "Continue to MCP setup"
- "Run setup wizard anyway"

Users don't know what "MCP setup" means or why they'd want to "run wizard
anyway" if Amplitude is already installed.

**Recommendation:** Rewrite:
- "Install Amplitude for your editor (recommended)"
- "Re-instrument my project from scratch"

---

## P3 — Nice to have

### 20. Log viewer improvements

- No scroll support (only shows last N lines)
- No log level coloring (ERROR/WARN/INFO all look the same)
- No pause/resume (auto-tailing can jump while user is reading)
- No search

**Recommendation:** Add at least Up/Down arrow scrolling and basic color coding
for log levels.

### 21. Report viewer markdown rendering is minimal

Only handles headings and horizontal rules. Bold, italic, lists, links, and
code blocks render as raw markdown.

**Recommendation:** Add basic markdown rendering for bold (`**text**`), lists
(`- item`), and code blocks (` ```code``` `).

### 22. Event plan viewer is not a table

EventPlanViewer renders events as a flat list despite the name suggesting tabular
layout. When there are 20+ events, it's hard to scan.

**Recommendation:** Render as a two-column table with aligned columns:
```
Event Name                  Description
─────────────────────────── ──────────────────────────
page_viewed                 User views a page
button_clicked              User clicks a CTA button
```

### 23. SplitView is always 50/50

The RunScreen SplitView puts TipsCard (left) and ProgressList (right) at equal
widths. Tips are verbose; progress items are short. The progress side wastes
space.

**Recommendation:** Use 60/40 or auto-size based on content.

### 24. Animation accessibility

DissolveTransition and AnimatedAmplitudeLogo have no off switch. Users with
motion sensitivity or on slow SSH connections may find them distracting.

**Recommendation:** Respect `TERM=dumb` or `NO_MOTION_PREFERENCE=1` env var to
disable animations. Fall back to instant transitions.

### 25. CI mode: add timestamps and structured output

CI logs lack timestamps. For long runs (5+ minutes), operators can't correlate
wizard output with other CI logs.

**Recommendation:** Add optional `--timestamps` flag or auto-detect CI and
prefix lines with `[HH:MM:SS]`.

Consider also a `--json` output mode for machine-parseable CI logs.

### 26. Add `/status` and `/debug` slash commands

Currently no way to inspect wizard state mid-run. Useful for debugging:

- `/status` — show current screen, run phase, detected framework, auth state
- `/debug` — dump session JSON to clipboard or log file

### 27. Small terminal handling

App.tsx clamps `contentHeight` to `Math.max(5, ...)` but doesn't handle the
case where the terminal is genuinely too small (e.g., 60x15). Content overflows
or is clipped without warning.

**Recommendation:** If terminal is below 80x24, show a single-line message:
"Terminal too small. Resize to at least 80×24."

---

## Per-screen findings

### IntroScreen
- Detection failure auto-selects "Generic" silently. Show "Couldn't detect
  framework, defaulting to Generic" briefly.
- FrameworkPicker `columns=2` may break on narrow terminals.
- Privacy assurance (".env contents won't leave your machine") is good — keep it.

### RegionSelectScreen
- Clean and simple. No issues.
- "(detected)" label is a nice touch for returning users.

### AuthScreen
- Auto-selection of single org/project is efficient but invisible. (See #8.)
- API key manual entry: error message "API key cannot be empty" should also
  suggest the expected format.
- "Only organization admins can access project API keys" is shown reactively on
  failure. Consider showing it proactively as a hint.

### DataSetupScreen
- Purely async check; auto-advances. Works well.
- Silent API fallback. (See #7.)

### SetupScreen
- No progress indicator. (See #9.)
- No back navigation for multi-question flows.
- "Detecting project configuration..." shown as plain text, not a LoadingBox.
  Inconsistent with other screens.

### RunScreen
- Best screen in the wizard. Tips, progress, tabs, easter eggs all work well.
- Task failure reasons are only visible in the Logs tab. Consider showing inline
  error summaries in the ProgressList.
- Tab switching keyboard shortcuts (arrow keys) not documented anywhere visible.

### McpScreen
- Pre-detected choice wording is confusing. (See #19.)
- Installation failure is silent. (See #7.)
- McpScreen is registered in both the flow and overlay registries with different
  props (overlay version has `onComplete`, flow version doesn't). Works but
  fragile.

### DataIngestionCheckScreen
- 30-second polling with no heartbeat between polls. (See #9.)
- Exit instructions ("Press q or Esc") are clear but don't explain what happens
  on resume.

### ChecklistScreen
- Disabled dashboard item. (See #10.)
- Auto-detection of existing charts/dashboards on mount is a good returning-user
  feature.

### SlackScreen
- Two-step confirmation is verbose. (See #17.)
- EU-specific Slack app note shown as yellow warning feels like an error.
  Consider using a neutral "Note:" prefix.
- Browser open failures are silent.

### OutroScreen
- Success path is excellent: clear summary, event list, next-step picker.
- Error/cancel paths are too sparse. (See #12.)
- Exit behavior inconsistency: success uses PickerMenu, error exits on any key.

### OutageScreen
- Clean. Clear messaging. Appropriate options (Continue / Exit).

### SettingsOverrideScreen
- Excellent error communication. Red border, clear explanation, recovery action.
- Model screen for how other error states should work.

### ActivationOptionsScreen
- Copy issues. (See #18.)
- Doesn't show when events were last seen or whether the SDK is actually running.

---

## Per-primitive findings

### PickerMenu
- Number shortcuts not discoverable. (See #15.)
- Multi-column layout doesn't check terminal width. May overflow.
- No search/filter for long lists (>20 items).
- Multi-select: pressing Enter without selecting anything implicitly selects
  the focused item. This should be documented or changed.

### ConfirmationInput
- Left/Right toggle is not obvious. Add visible `[←/→ to switch]` hint.
- No visual separator between Continue and Cancel options.

### ProgressList
- Triangle icon (▶) for "in progress" isn't universally recognized as
  "running." Consider using a spinner character.
- No estimated time remaining.
- `activeForm` label swap happens without any visual indicator that the task
  name changed.

### LogViewer
- No scroll. No pause. No color coding. (See #20.)
- "No log file found" message doesn't explain whether this is transient or
  permanent.

### ReportViewer
- Minimal markdown rendering. (See #21.)
- Scroll position resets when file updates. User loses their place.
- j/k vim keys work but aren't documented.

### EventPlanViewer
- Not actually a table. (See #22.)
- Long descriptions may overflow without wrapping.

### TabContainer
- Tab overflow not handled. If tabs exceed terminal width, they wrap or clip.
- Help text "← → to browse tabs" always shown, wastes space on small terminals.
- No number-key shortcuts to jump to specific tabs.

### SlashCommandInput
- Backspacing to empty deactivates the input. Users may expect it to stay
  active.
- Command matching is case-sensitive on the command name but case-insensitive on
  the description. Inconsistent.
- Filtered list has no scroll support for many commands.

### DissolveTransition
- No way to disable for accessibility. (See #24.)
- Shade characters (░▒▓█) depend on terminal font support; some terminals
  render them as boxes.

---

## CI mode findings

### Output format issues
- Carriage returns in non-TTY mode. (See #11.)
- No timestamps. (See #25.)
- No structured/JSON output option.

### Progress reporting
- `syncTodos()` only prints the in-progress task. No "task complete" line when
  a task finishes. CI operators can't tell if progress is advancing.
- No heartbeat for long-running operations. CI systems may timeout thinking the
  process is dead.

### Prompt semantics
- All prompts log "(auto-skipped in CI)" or "(auto-approved in CI)" which is
  good, but `promptConfirm` returning `false` (skip) while `promptEventPlan`
  returning `approved` (accept) is asymmetric. Document this clearly.

### Error handling
- `setRunError()` returns `false` (no retry). If the error is transient (rate
  limit, network blip), CI mode has no retry path.
- **Recommendation:** Add `--retries N` flag for CI mode to retry transient
  agent errors.

### Missing output
- No summary at the end of a CI run listing what was created/modified.
- No exit code differentiation (success=0, error=1, partial=2).

---

## Infrastructure findings

### Store (`store.ts`)

- **Direct array mutation in `addDiscoveredFeature()`**: Pushes to
  `session.discoveredFeatures` directly instead of creating a new array. React
  may miss the update if it compares by reference.
- **No validation in `setFrameworkContext()`**: Accepts any key/value without
  schema validation. Low risk but worth noting.
- **Promise leak in feedback submission**: `trackWizardFeedback()` can hang
  for 30s+ with no abort signal. If the user exits, the promise is orphaned.

### Router (`router.ts`)

- **No overlay stack limit**: `pushOverlay()` has no depth check. Theoretical
  memory concern if buggy code pushes overlays in a loop.
- **No mutual exclusion**: Login and Logout overlays can stack simultaneously.
  Guard against this.
- **`activeScreen` fallback**: Returns `this.flow[0].screen` before session is
  available. If `flow[0]` has a `show: () => false` predicate, this causes a
  brief flash of the wrong screen on startup.

### Flows (`flows.ts`)

- **Region change doesn't re-trigger data check**: `setRegionForced()` resets
  `projectHasData` to `null`, but there's no mechanism to re-run the
  DataSetupScreen API call. If a user changes region mid-setup, stale data
  persists.
- **No credential expiry handling**: The flow assumes `credentials !== null`
  means auth is valid. But OAuth tokens expire. No in-flow re-auth path exists
  (only the `/login` slash command).

### App.tsx

- **No top-level error boundary**: `ScreenErrorBoundary` wraps only the active
  screen content. If `TitleBar` or `ConsoleView` crashes, the entire TUI
  unmounts with no recovery.
- **Negative content dimensions possible**: If terminal is resized to very small
  (e.g., 40x10), `contentHeight` and `contentAreaWidth` can become misleadingly
  small, causing Ink layout to clip or wrap unexpectedly.

---

## Summary

| Priority | Count | Theme |
|----------|-------|-------|
| **P0** | 5 | Bugs: store race, null screen, timer leak, terminal restore, orphaned promise |
| **P1** | 7 | UX: help overlay, silent failures, auto-select visibility, progress indicators, CI output, error outro |
| **P2** | 7 | Polish: keyboard consistency, terminology, discoverability, back nav, verbose flows, copy |
| **P3** | 8 | Nice-to-have: log viewer, markdown, tables, split view, animations, timestamps, debug commands, small terminals |

The highest-leverage changes are:
1. Fix the P0 bugs (store race, terminal restore, timer leak)
2. Add a help overlay so users can discover features
3. Surface errors instead of silently falling back
4. Fix CI carriage returns for non-TTY environments
5. Add progress indicators to polling/multi-step screens
