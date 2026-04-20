## Bet 5 — Recovery & Delight

**Branch:** `kelsonpw/recovery-ux`
**Depends on:** nothing. Can ship in parallel with Bets 1–3.
**Effort:** ~2 sprints.

### Goal

Turn the UX from "tool devs finish" into "tool devs screenshot." Make error paths productive, make success paths shareable, make slash commands discoverable, add a PLG loop at the peak moment. Don't rewrite the framework; polish what's there.

### Deliverables

#### Error outro as recovery launchpad
- [ ] Rewrite `src/ui/tui/screens/OutroScreen.tsx:148-177` error/cancel paths.
- [ ] Always show: (a) log path with "press L to open", (b) "press R to resume from checkpoint" when one exists, (c) "press C to copy sanitized bug report", (d) framework-specific docs URL.
- [ ] Match the polish level of the existing `SettingsOverrideScreen`.
- [ ] Clipboard fallback: if terminal doesn't support clipboard, write to `/tmp/amplitude-bug-report.txt` and show that path.

#### `?` / `/help` overlay
- [ ] Bind `?` globally in `src/ui/tui/components/ConsoleView.tsx` to an overlay listing slash commands + current-screen keybinds + log path.
- [ ] Reconcile `src/ui/tui/console-commands.ts:COMMANDS` with the README — every documented command must exist, or delete it from README.
- [ ] Test overlay mutual-exclusion with `SlashCommandInput`.

#### Kill auth for returning users
- [ ] Call `tokenRefresh()` from `src/utils/token-refresh.ts` in `bin.ts` before Ink mounts.
- [ ] If successful, hydrate `session.credentials` before the flow begins; the `Auth` `FlowEntry`'s `show:` predicate already returns false when credentials exist.
- [ ] Instrument `wizard cli: auth refreshed silently` and `wizard cli: auth refresh failed {reason}`.
- [ ] Target: returning-user run-start time (`wizard cli: run started` → first screen past auth) drops to <3s p50.

#### Collapsed org/workspace/env picker
- [ ] Rebuild `src/ui/tui/screens/AuthScreen.tsx` to show a single searchable list ("Acme / Analytics / Production") with last-used pre-focused.
- [ ] Persist last-used selection to `~/.ampli.json`.
- [ ] Fall back to stepped pickers only above ~40 items.
- [ ] Fix the misleading "Select a project" label at `src/ui/tui/screens/AuthScreen.tsx:540` — it's the env picker. Rename to "Select environment."
- [ ] Terminology audit: ensure README and in-product copy both use "Org → Workspace → Project → Environment" consistently.

#### "While you wait" on `DataIngestionCheckScreen`
- [ ] Replace the static spinner at `src/ui/tui/screens/DataIngestionCheckScreen.tsx:461-471` with a rotating preview.
- [ ] Show: live event count, dashboard preview materializing, first chart title animating in, masked API key with "copied to clipboard" hint.
- [ ] Pre-fetch the dashboard template during the poll so the celebration is instant, not a 3s stall.
- [ ] Gate pre-fetching behind a 20s dwell to avoid wasted work if the user quits early.

#### Persistent launch-pad TUI
- [ ] Rebuild `src/ui/tui/App.tsx` as a three-pane layout:
  - Left pane: vertical `JourneyStepper` as live checklist.
  - Center pane: current interaction (prompts, inputs, confirmations).
  - Right pane: telemetry preview materializing in real time — event count animating up, first chart title fading in, dashboard preview.
- [ ] Reuse existing `JourneyStepper`, `ConsoleView`, brand styles. Don't rewrite Ink/nanostores.
- [ ] Respect terminal width: fall back to single-pane on narrow terminals (<100 cols).
- [ ] Respect accessibility: screen-reader-friendly output, no color-only signaling.

#### PLG loop — teammate invite
- [ ] On `OutroScreen` success path, add "Send this dashboard to a teammate" action.
- [ ] Deep-link to Amplitude web's share flow with `dashboard_id` pre-filled.
- [ ] Instrument `wizard cli: teammate invite link opened` and `wizard cli: teammate invite sent` (detect-on-web via deep-link query param).
- [ ] Target: viral coefficient k ≥ 0.05 within 30 days.

#### "Save your first chart" moment
- [ ] On success, render an ASCII sparkline of the first chart using box-drawing characters.
- [ ] Offer "press S to copy a pre-filled tweet" with event count and dashboard link.
- [ ] Future: PNG export behind a flag (not this bet).

### Verification

- Manual QA: simulate a crash mid-run. Error outro surfaces log path, resume option, bug-report copy. All four actions work.
- Unit tests for `?` overlay mutual-exclusion.
- `wizard cli: teammate invite link opened` fires with non-zero volume within 7 days of rollout.
- Returning-user run-start p50 <3s (measured via `wizard cli: run started` → `wizard cli: step completed {step: 'auth'}`).
- BDD test for the searchable org/workspace/env picker with fuzzy matching.
- Accessibility check: output readable without color on a plain terminal.

### Kill criteria

- Teammate-invite viral coefficient k<0.05 after 30 days → remove the invite prompt (don't leave a lukewarm CTA on the peak moment).
- Three-pane TUI causes layout issues on >5% of user terminals → revert to single-pane default with three-pane behind a flag.

### Out of scope

- TUI rewrite on `@clack/prompts` or `enquirer` (separate bet, not funded yet).
- PNG screenshot export (phase 2).
- Localization (separate effort).
