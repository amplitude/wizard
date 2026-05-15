# Timeline UX — PR plan

Ten sequenced PRs, each behind `WIZARD_NEW_UX=1` until PR 10 flips the default.

## PR 1 — terminalCapabilities + layout shell — M
Add: `terminalCapabilities.ts`, `ScreenShell.tsx`, `StepIndicator.tsx`. Pure detection; canonical 3-region layout; UTF-8/ASCII degradation; snapshots at 3 capability levels.

## PR 2 — WizardVoice + lint guardrail — S
Add: `voice.ts` + tests. 14 canonical voice exports. ESLint `no-restricted-syntax` rule drafted (activates in PR 10).

## PR 3 — ScreenHotkeyBar + SlashPalette skeleton — M
Add: `ScreenHotkeyBar.tsx` (absorbs `HotkeyPills` via re-export), `SlashPalette.tsx`, `fuzzyRank.ts`. Width-responsive pills. `/` opens palette, fuzzy-ranks 13 existing slash commands + 4 new stubs.

## PR 4 — RunTimeline — L
Add: `RunTimeline.tsx`, `RunTimelineLedger.tsx`, `RunTimelineTodos.tsx`. Subscribes to nanostores narrowly. Voice line + todos + ledger + extras + receipt footer. Snake/Logs tabs retired in favor of `/snake` and `[l]`.

## PR 5 — ProjectPicker — M
Fuzzy + `%org`/`%env`/`%name` column scoping. Windowed to ≤50 rows; ≤100 Text nodes. Inline `n` for new project.

## PR 6 — Tab-to-ask — L ⚠ killer feature
Add: `AskBar.tsx`, `agentInterrupt.ts`, `$paused`, `$askHistory`. Tab pauses agent ≤500ms with synchronous ack; Esc cancels; ↑ recalls. Agent reply renders inline as `›` block.

## PR 7 — Auth redesign — M
OAuth pairing phrase + spinner + URL; `[k]` API-key fallback always visible; masked input; device-code auto-engages on `!isInteractive()` or callback-bind failure; structured `auth_required` payloads.

## PR 8 — ExtrasPanel + MCP/Slack promotion — M
ExtrasPanel renders MCP/Slack/Session Replay with 5 states. Promoted on Welcome (returning), Plan, Run, Verify, Done. Detect existing MCP clients; surface Slack workspace from org context.

## PR 9 — Resume, outage banner, error variants — M
Returning-user welcome with checkpoint summary; OutageBanner pinned above StepIndicator on degraded status; Done variants (success/cancel/error) with copy-paste resume commands.

## PR 10 — Flag flip + voice sweep + finalize — S
Sweep every screen for hand-written status strings, replace with `voice.*`. Flip `WIZARD_NEW_UX=1` to default. Activate ESLint rule. Both design docs referenced from `CLAUDE.md`.

## Staging

- **Internal**: PRs 1–5 land; dogfood with `WIZARD_NEW_UX=1`.
- **Tab-to-ask preview**: PRs 6–8 land; invite testers via `--preview-ux`. Threshold to proceed: ≥80% of Tab users report useful response <5s.
- **Default flip**: PRs 9–10 land. Threshold to deprecate `WIZARD_OLD_UX=1`: 2 weeks at ≥99% completion rate.

## Stop-shipping signals

- Any screen >100ms p95 render → revisit windowing
- Tab ack p95 >500ms → back out PR 6
- ≥5% sessions hit OutageBanner → infrastructure issue, not UX
