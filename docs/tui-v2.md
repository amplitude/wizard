# TUI v2 — IA, Glyph Palette, Operator Overview

> **Status:** delivered as PR 5 of the v2 stack (`feat/v2-tui-redesign`).
> Stacks on PRs 1–4. This doc captures the screen-tree + IA contract
> introduced in that PR so future contributors can extend it without
> drifting from the operator-grade vocabulary.

## Why v2

The TUI we shipped before v2 grew organically around `WizardSession`
(in-memory display state) and a fast-changing flow pipeline. It was
adequate for the happy path but the edges were rough:

- screens needed terminal resize to redraw after some transitions
- prompts could disappear or get re-asked after a durable answer
- "success" UI showed up while a manual verification was still pending
- background agents were hard to distinguish from user-directed work
- `/status` was usable but not refreshable while open
- the slash-command bar was easy to miss during active runs

PRs 1–4 fixed the **substrate** (durable orchestration store, lifecycle,
choice/verification primitives, supervisor with PID + heartbeats, live
file-watcher refresh). PR 5 is the **surface** — the IA, vocabulary,
and screen tree the operator actually sees.

## Three-zone layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ✓ Welcome ─ ✓ Auth ─ ● Setup ←  ─ ○ Verify ─ ○ Done                       │ ← stepper
│ Amplitude Wizard  [agent]               · Acme / Web App / Production    │ ← header + mode badge + identity
│ ─────────────────────────────────────────────────────────────────────── │
│                                                                         │
│ Tasks                          Discovered facts                         │
│ ✓ Detect framework             · framework=Next.js                       │
│ › Install Amplitude            · package_manager=pnpm                    │
│ ○ Plan and approve events      · TypeScript=yes                          │
│ ○ Wire up event tracking                                                 │
│   · Reading package.json                                                │
│   · Running pnpm add @amplitude/analytics-browser                       │
│                                                                         │
│ ◆ Manual verification pending                                           │
│ ─ Confirm events arrive in Amplitude (resume: wizard verification mark) │
│                                                                         │
│ ─────────────────────────────────────────────────────────────────────── │
│ ◆ Status: pnpm install (3.4s)                                           │ ← inline status pill
│ ─────────────────────────────────────────────────────────────────────── │
│ Tab=ask  ←/→=tabs  Ctrl+C=cancel                                        │ ← key hint bar
│ ❯ Press / for commands or Tab to ask a question                         │ ← slash prompt line
└─────────────────────────────────────────────────────────────────────────┘
```

### Zone 1 — Header (≤ 2 rows)

- Row 1: **JourneyStepper** — `Welcome → Auth → Setup → Verify → Done`
  with the canonical glyph palette below.
- Row 2: **HeaderBar** — title + **mode badge** (`[agent]` / `[ci]` /
  `[nested]` / `[mcp-server]`; suppressed in plain interactive mode) +
  org/project/env identity.

### Zone 2 — Body (flex, dominant)

- Active screen content. `RunScreen` uses a two-column layout when the
  terminal is wide enough (≥ 110 cols): left = primary user-directed
  work (Tasks + active substeps + file writes), right = secondary status
  (Discovered facts, MCP capability lifecycle).
- The animated logo is gone from the run view (per #688's decision); it
  only appears on Welcome.

### Zone 3 — Chrome (≤ 3 rows)

- Inline status pill (the PR-3/688 decision) flush with content.
- KeyHintBar with screen-specific hints (`Tab`, `←→`, `Ctrl+C`).
- Slash-command prompt line (`❯ Press / for commands or Tab to ask`).

## Glyph palette (canonical vocabulary)

Every primary surface — JourneyStepper, ProgressList rows, the
operator overview, choice banners, manual-verification ribbon,
MCP-capability rows — draws from one shared palette so the user only
has to learn it once.

| State        | Glyph | Color    | Semantic meaning                            |
|--------------|:-----:|----------|---------------------------------------------|
| Queued       |  `○`  | muted    | Created, awaiting start                     |
| Running      |  `›`  | violet   | Actively executing                          |
| Waiting      |  `…`  | blue     | Paused on a user choice / verification      |
| Blocked      |  `⏸`  | red      | Cannot proceed (auth, network, dep)         |
| Completed    |  `✓`  | success  | Terminal: success                           |
| Failed       |  `✗`  | red      | Terminal: failure                           |
| Cancelled    |  `⊘`  | amber    | Terminal: cancelled by user                 |
| Superseded   |  `⮕`  | muted    | Terminal: replaced by another task          |

The mapping lives in `src/ui/tui/utils/lifecycle-display.ts` and is
sourced from the `TaskLifecycle` enum. Tests pin the palette so a
silent drift trips a unit test, not a screenshot review.

## Mode badges

The header surfaces the current execution mode so the operator can see
at a glance what they're running. Resolution priority (first match
wins):

1. `CLAUDECODE=1` or `CLAUDE_CODE_ENTRYPOINT=…` → `[nested]`
2. `AMPLITUDE_WIZARD_MCP_SERVE=1` → `[mcp-server]`
3. `AMPLITUDE_WIZARD_AGENT_MODE=1` → `[agent]`
4. `AMPLITUDE_WIZARD_CI=1` or `CI=true` → `[ci]`
5. fallback → `[interactive]` (suppressed; the default)

`AMPLITUDE_WIZARD_ALLOW_NESTED=1` opts out of nested detection so
`[agent]` / `[ci]` can show through when CI runs the wizard from inside
another Claude session intentionally.

## Operator Overview screen (`/status`)

Invoked via the `/status` slash command. The brief asks for an
"accessible 'what's happening?' surface" — this is it.

```
◆ Operator overview                      · [agent]
Waiting on 1 choice from you.
Live snapshot — press Esc to close.

Session (1)
● id: session_01HXYZ…
● goal: Instrument Next.js project
● branch: feat/wizard

Primary work (2)
›  Running — Detect framework
…  Waiting — Approve event plan

Pending choices (1)
◆ Approve the event plan?
  why: Plan needs human review.
  recommended: Approve all 8 events
  if skipped: No events get instrumented.
  reversible: yes · requires_human: yes · safe to skip
  resume: npx @amplitude/wizard --install-dir /path

Pending verifications (1)
● Confirm events arrive in Amplitude
  expected: Live Event Stream shows the 8 approved events.
  resume: wizard verification mark <id> --status passed

MCP capabilities (2)
● amplitude_mcp_http · installed — user-approved-on-prompt
● claude_code_mcp · install_skipped — user-declined-on-prompt

⮕ Next: Approve or revise the event plan
  resume command: npx @amplitude/wizard --install-dir /path
```

Sections:

- **Header** — title + mode badge + 1-line summary ("Waiting on N
  choices from you.") so the answer to "what's the wizard doing?" is
  visible even on a 24-row terminal where lower sections clip.
- **Session** — id / goal / branch / worktree, when one is active.
- **Primary work** — running / waiting / blocked tasks; the user's
  direct attention rows.
- **Background** — queued tasks; rendered only when non-empty.
- **Pending choices** — full UX contract: why-asking, recommended,
  consequence, reversibility, requires-human, safe-to-skip, resume.
- **Pending verifications** — what to verify, expected behavior,
  unblocker hint, resume command.
- **MCP capabilities** — visible-but-not-prompting (anti-nag): a
  skipped install shows up here so the user can audit, but does NOT
  re-prompt.
- **Owned artifacts** — branches/worktrees/PRs the wizard tracks.
- **Next action** — recommended next step + resume command.

The overlay is **live** — it subscribes to the orchestration store via
`useOrchestrationStore(installDir)` (PR 4's file-watcher hook), so a
sibling shell running `wizard choice answer …` updates the open
overlay without a manual close + re-open.

## Prompt UX contract

Every choice prompt (the 14 surfaces wired in PR 4) renders the full
contract:

| Field                  | Source                                     |
|------------------------|--------------------------------------------|
| Why-asking             | `Choice.whyAsking`                         |
| Options                | `Choice.options[]`                         |
| Option descriptions    | `Choice.options[i].description`            |
| Recommended option     | `Choice.recommendedOptionId`               |
| Safe-default option    | `Choice.safeDefaultOptionId`               |
| Reversible             | `Choice.reversible`                        |
| Requires human         | `Choice.requiresHuman`                     |
| Consequence if skipped | `Choice.consequenceIfSkipped`              |
| Resume command         | `Choice.resumeCommand`                     |
| Skip safety            | derived: safe-default + !requires-human + reversible |

`ChoiceCheckpointBanner` renders the full block; the operator overview
renders an inline condensed version that still includes every field so
the operator can decide without leaving the overlay.

## Slash commands (coherent during active runs)

`/help` (new in PR 5) lists every registered command grouped by
"available anytime" vs "available before/after a setup run". When a
run is active, the second group is renamed "paused while a setup run
is active (Ctrl+C to cancel, then retry)" so the user knows exactly
why a command can't fire and what to do about it.

| Command          | Mid-run? | Purpose                                              |
|------------------|----------|------------------------------------------------------|
| `/region`        |    ⏸     | Switch data-center region (US or EU)                |
| `/login`         |    ⏸     | Re-authenticate                                     |
| `/logout`        |    ⏸     | Clear stored credentials                            |
| `/whoami`        |    ✓     | Show current user, org, and project                 |
| `/create-project`|    ⏸     | Create a new Amplitude project inline               |
| `/mcp`           |    ✓     | Install or remove the Amplitude MCP server          |
| `/slack`         |    ✓     | Set up Amplitude Slack integration                  |
| `/feedback`      |    ✓     | Send product feedback                               |
| `/clear`         |    ✓     | Clear the Q&A conversation history                  |
| `/debug`         |    ✓     | Print a diagnostic snapshot                         |
| `/diagnostics`   |    ✓     | Show wizard storage paths                           |
| `/status`        |    ✓     | Show orchestration overview                         |
| `/help`          |    ✓     | List slash commands                                 |
| `/snake`         |    ✓     | Play Snake                                          |
| `/exit`          |    ✓     | Exit the wizard                                     |

## Render-cost teardown

The TUI used to subscribe every component to the whole-store version
counter via `useWizardStore(store)`. Every emit (e.g. `pushStatus`)
forced a reconciliation on **every** subscriber — the FileWritesPanel,
the DiscoveryFeed, the JourneyStepper — even when none of them
actually read changed data.

PR 5 adds **`useWizardSelector(store, selector, isEqual?)`** in
`src/ui/tui/hooks/useWizardSelector.ts`. Components that only care
about a slice (e.g. `session.region`) subscribe to that slice; the hook
caches the last value and bails out of re-renders when the equality
function returns true.

Render-cost benchmark fixture (`src/ui/tui/__tests__/render-cost.test.tsx`):

| Subscriber type | 3 task transitions + 5 status bumps | Slice mutations |
|-----------------|------------------------------------|------------------|
| Whole-store     | 8+ renders                         | 8+ renders       |
| Tasks slice     | 3 renders                          | 3 renders        |
| Status slice    | 5 renders                          | 5 renders        |

Equality helpers `shallowArrayEqual` and `shallowObjectEqual` are
exported alongside for the common case of arrays / objects whose
contents are stable but whose references change on every store tick.

## Layout viewports

ASCII spec for three reference viewport widths:

### Wide (142×41)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ✓ Welcome ─ ✓ Auth ─ ● Setup ←  ─ ○ Verify ─ ○ Done                                                                              │
│ Amplitude Wizard  [agent]                                                                                · Acme / Web App / Prod  │
│ ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── │
│                                                                                                                                  │
│ Tasks                                                                  Discovered facts                                          │
│ ✓ Detect framework                                                     · framework=Next.js                                        │
│ › Install Amplitude                                                    · package_manager=pnpm                                     │
│ ○ Plan and approve events                                              · TypeScript=yes                                           │
│ ○ Wire up event tracking                                                                                                          │
│   · Reading package.json                                                                                                          │
│   · Running pnpm add @amplitude/analytics-browser                                                                                 │
│ …                                                                                                                                │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Standard (100×30)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ✓ Welcome ─ ✓ Auth ─ ● Setup ←  ─ ○ Verify ─ ○ Done                                                  │
│ Amplitude Wizard  [agent]                                                · Acme / WebApp / Prod      │
│ ──────────────────────────────────────────────────────────────────────────────────────────────────  │
│                                                                                                    │
│ Tasks                                                                                              │
│ ✓ Detect framework                                                                                  │
│ › Install Amplitude                                                                                 │
│   · Reading package.json                                                                            │
│ ○ Plan and approve events                                                                          │
│ ○ Wire up event tracking                                                                           │
│ ──────────────────────────────────────────────────────────────────────────────────────────────────  │
│ ◆ Status: pnpm install (3.4s)                                                                       │
│ Tab=ask  ←/→=tabs  Ctrl+C=cancel                                                                   │
│ ❯ Press / for commands                                                                              │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Narrow (80×24)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ✓ ─ ✓ ─ ● ─ ○ ─ ○                                                            │
│ Amplitude Wizard  [agent]                       · Acme / WebApp              │
│ ────────────────────────────────────────────────────────────────────────────  │
│ Tasks                                                                        │
│ ✓ Detect framework                                                            │
│ › Installing Amplitude                                                        │
│ ○ Plan events                                                                │
│ ○ Wire up                                                                    │
│ ────────────────────────────────────────────────────────────────────────────  │
│ ◆ pnpm add … (3.4s)                                                           │
│ Ctrl+C=cancel                                                                │
│ ❯ /                                                                          │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Backward compatibility

- All existing slash commands continue to work the same way; `/help` is
  additive.
- The `/status` overlay's data shape is unchanged from PR 3; only the
  rendering reorganized.
- `--agent`, `--ci`, `--json`, `manifest`, `plan`, `apply`, `verify`,
  MCP server, `v: 1` envelope, exit codes — all unchanged.
- The mode badge does not appear in `[interactive]` mode, preserving
  the prior header look for the most common case.

## Known limitations & follow-ups

- ProgressList still uses a blank gutter for `pending` rows rather than
  the canonical `○` glyph (deliberate UX trade-off — see comment in
  `ProgressList.tsx`). A future PR could make this configurable.
- Render-cost helpers exist (`useWizardSelector`); migrating every
  subscriber over is out of scope for PR 5. The infrastructure is in
  place, the migration is incremental.
- The operator overview is rendered via the same overlay infrastructure
  as before; it doesn't yet support keyboard-actionable choice
  resolution from inside the overlay (the current contract: read here,
  act in the parent screen).
