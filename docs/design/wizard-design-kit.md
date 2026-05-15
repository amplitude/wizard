# Amplitude Wizard — Design Kit

## Principles

**1. One canonical layout.** Every screen has three regions: step indicator on top, body in the middle, hotkey rail on the bottom. Never invent new chrome.

**2. Voice is lowercase, first-person, present tense.** "i'm wiring up your tracking" — not "TASK 3 IN PROGRESS." No exclamation marks. No emoji bullets. No "Great!" or "Awesome!" Capitalize proper nouns and quoted event names only.

**3. Where am I, what's next, what just happened.** Step indicator answers "where." Title and CTA answer "what's next." A receipts ledger answers "what just happened." All three visible at all times.

**4. Receipts beat logs.** If we narrate "i'm wiring up your tracking now," we owe a one-line receipt: `✎ src/app/layout.tsx +12 −3 · 240ms`. Full logs live behind `[l]`.

**5. Calm by default, dense on demand.** Default shows the work and recent receipts. Drill-down is one keystroke: `[d]` diff, `[e]` events, `[l]` logs, `[/]` palette, `[Tab]` ask.

**6. Linear flow, overlays for inspection.** Welcome → Auth → Project → Plan → Run → Verify → Done. Inspectable surfaces (diff, logs, events) are overlays that slide over the timeline, never tabs. Timeline keeps streaming behind the overlay.

**7. Extras are first-class.** MCP, Slack, and Session Replay show up as visible queued/installing/done states on Welcome (returning user), Plan, Run, Verify, and Done. Never buried.

**8. Color is never the only signal.** Every colored token has a glyph or label too. ✓ ✗ ● ○ ❯ — these carry the meaning. Color is reinforcement.

**9. Tab pauses the agent.** From the Run screen, Tab pauses within 500ms with an inline acknowledgment, accepts a free-form question, and resumes after the agent replies. Don't break this.

**10. Cross-platform contract.** Every screen renders correctly with `WIZARD_FORCE_ASCII=1` and `WIZARD_FORCE_NO_COLOR=1`. Detect truecolor, UTF-8, and rounded corners via a single `useTerminalCapabilities()` hook. Degrade gracefully.

**11. State is nanostores.** Subscribe narrowly via `@nanostores/react useStore`. Inputs are `@inkjs/ui` only — no `ink-text-input` or `ink-select-input` additions.

**12. No console.log in screens.** Ever.

---

## Tokens

### Color

5 tokens. That's it.

| Token       | Truecolor                       | 16-color fallback | Use                                          |
|-------------|---------------------------------|-------------------|----------------------------------------------|
| `amp.blue`  | `#4083FF` on dark / `#0052F2` on light | `cyan`            | Primary, current step, CTA, hotkeys          |
| `amp.lilac` | `#A373FF`                       | `magenta`         | Extras: MCP, Slack, Session Replay, in-flight |
| `amp.text`  | terminal default                | default           | Body                                          |
| `amp.muted` | `#697077`                       | `gray` / `dim`    | Receipts, ledger, hints, paths                |
| `amp.red`   | `#F23845`                       | `red`             | Fatal errors only                             |

Optional: `amp.success` `#62C68B` / `green` — receipts ledger checkmarks only, never decorative.

Truecolor only when `COLORTERM === 'truecolor'`. No yellow, no orange. Never rely on color alone.

### Glyphs (safe set)

```
✓  done
✗  failed
●  in progress / current
○  pending
◆  highlight / marker
▲  agent speaking
▼  collapsed section
❯  step pointer / prompt
⋯  truncated / more
│ ─ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼   box drawing
╭ ╮ ╰ ╯                  rounded (UTF-8 only)
```

Braille spinner: `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` on UTF-8. ASCII fallback `|/-\`. Never double-line box. Never emoji.

### Typography

- Lowercase, first-person, present tense
- Capitalize proper nouns and quoted event names ("Signup Completed")
- Sentence case for labels
- Numbers and code are monospace, unstyled
- No `!`

### Spacing

- Max content width: 80 cols when terminal ≥100, else `cols − 4`
- Two-space indent inside boxes
- One blank line between sections, never two
- Hotkey rail always on the last visible row

### Hotkeys (standard set)

```
[d]    diff overlay
[e]    events overlay
[l]    logs overlay
[L]    lens mode toggle (60/40 split)
[Tab]  ask the agent
[/]    slash palette
[Esc]  close overlay / cancel
[?]    help
[↑↓]   scroll / navigate
[↵]    confirm / submit
```

Hotkey rail format: `[d] diff  [e] events  [l] logs  [tab] ask  [/] more` — key in `amp.blue`, label in `amp.text` or muted.

---

## Voice library (canonical lines)

| Situation              | Voice                                                  | Receipt                                |
|------------------------|--------------------------------------------------------|----------------------------------------|
| Auth start             | `i'll open your browser to sign you in`                | —                                      |
| Browser wait           | `waiting on your browser tab...`                       | —                                      |
| Signed in              | `signed in as jane@acme.com`                           | `✓ logged in`                          |
| Detecting              | `looking at your codebase`                             | —                                      |
| Detected               | `found Next.js 15 in apps/web`                         | —                                      |
| Editing                | `editing src/app/layout.tsx`                           | `✎ src/app/layout.tsx +12 −0`          |
| Installing             | `installing @amplitude/analytics-browser with pnpm`    | `+ @amplitude/analytics-browser@2.x`   |
| Event wired            | `wiring up Signup Completed`                           | `+ event: Signup Completed (3 props)`  |
| Done                   | `all set, you're tracking 7 events in production`      | —                                      |
| Recoverable error      | `couldn't reach the project list, retrying...`         | —                                      |
| Fatal error            | `i couldn't finish this. here's what to try:`          | (full error block)                     |
| Tab interrupt          | `what would you like me to do?`                        | —                                      |

Words we never use: TASK, STEP, PHASE, INITIALIZING, EXECUTING, "Great!", "Awesome!", "Please."

---

## Receipts format

After any multi-step screen completes:

```
elapsed 3m 18s · $0.14 used
+ 7 events wired
+ 4 files changed (+58 −2)
+ mcp installed in cursor, claude, zed
○ slack — skipped
```

Time, cost, files, events, extras. Always in that order.

---

## Per-screen iteration prompt (copy this into Claude Code each time)

```
You are iterating one screen of the Amplitude Wizard TUI.

SCREEN TO BUILD: <name and file path, e.g., AuthScreen at src/ui/tui/screens/AuthScreen.tsx>

PURPOSE: <one sentence — what this screen does in the user's journey>

INPUTS / STATE:
- Reads from nanostores: <list atoms, or "none">
- Receives props: <list, or "none">
- Writes to nanostores: <list, or "none">

WHAT THE USER SHOULD KNOW AT A GLANCE:
1. <where they are>
2. <what is happening>
3. <what they can do next>

PRIMARY ACTION: <one sentence — the keystroke or interaction that moves forward>

SECONDARY ACTIONS: <list of hotkeys for this screen>

EDGE CASES:
- <e.g., no network>
- <e.g., empty state>
- <e.g., ascii fallback>

DELIVERABLES:
1. Implementation in <file path>
2. ink-testing-library snapshots at 80, 60, and 40 cols
3. ASCII fallback snapshot
4. Manual walk-through in dev with WIZARD_NEW_UX=1

CONSTRAINTS — read /docs/design/wizard-design-kit.md before starting. Do not deviate from:
- The 12 principles
- The 5-color palette (amp.blue, amp.lilac, amp.text, amp.muted, amp.red)
- The safe glyph set
- The voice library — all status strings go through src/ui/tui/lib/voice.ts; never hand-write
- The ScreenShell wrapper (step indicator + body + hotkey rail)
- @inkjs/ui only for inputs
- @nanostores/react useStore, subscribe narrowly
- No console.log in src/ui/tui/**
- Cross-platform: must render with WIZARD_FORCE_ASCII=1 and WIZARD_FORCE_NO_COLOR=1

BEFORE WRITING CODE:
1. Re-read /docs/design/wizard-design-kit.md
2. Show me a plain-text ASCII mock of the screen at 80 cols. Wait for approval.
3. Once approved, show me a second mock at 60 cols. Wait for approval.
4. Once both approved, implement.

AFTER IMPLEMENTATION:
- Run pnpm test, pnpm lint, pnpm typecheck. Fix any failures.
- Open the wizard with WIZARD_NEW_UX=1 and walk the screen.
- Report: file paths changed, tests added, ACs met, anything deferred.

Do not start on the next screen. Wait for me to send the next prompt.
```

---

## How to use this kit

1. Commit `/docs/design/wizard-design-kit.md` containing everything above (principles + tokens + voice library + receipts + the per-screen prompt template). One commit, on a branch.
2. Add a CLAUDE.md note: "Before any work in `src/ui/tui/**`, read `docs/design/wizard-design-kit.md`."
3. For each screen, fill in the prompt template and paste it into Claude Code. The agent shows you mocks before writing code. You approve, it builds, it stops. You move to the next screen.
4. After 3 or 4 screens are in, audit for drift. The voice will start sliding back into "Loading..." and "Please wait..." unless you push back.

The thing that keeps a screen-by-screen approach from going off the rails is **the mock gate**. Forcing the agent to produce a plain-text ASCII mock at 80 cols and 60 cols and wait for approval before writing TSX is what keeps each screen anchored to the principles. If you skip that, you'll end up with 20 screens that each looked fine in isolation but don't compose.

Start with **RunScreen** (the timeline), not Welcome. RunScreen is where the design decisions hurt most — voice cadence, ledger density, hotkey real estate, extras visibility. Once that's right, the simpler screens fall into place. Welcome first means you'll redesign it after Run anyway.
