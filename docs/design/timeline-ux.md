# Amplitude Wizard — Premium TUI Design Principles

## Thesis

The wizard is the first 10 minutes a developer ever spends with Amplitude. Those 10 minutes should feel like flying a small, well-engineered plane: quiet, instrumented, in-your-hands. We'll get there by replacing disjointed screens with one canonical structure (StepIndicator at top, content in the middle, ScreenHotkeyBar at bottom, slash palette and ask-bar on call), one calm voice (lowercase, first-person, present tense), and one extras tray (MCP, Slack, Session Replay) that is always one keystroke away but never in the way.

## Information architecture principles

1. **One canonical layout, always.** Every screen renders three regions: Header (StepIndicator + screen title), Body (the work), Footer (ScreenHotkeyBar + transient status line). No screen invents its own chrome.
2. **Where am I, what's next, what just happened — visible at all times.** StepIndicator answers "where". Screen title and primary CTA answer "what's next". A 1-line receipts ledger answers "what just happened".
3. **Linear by default, drill-down by request.** Main flow: Welcome → Region → Auth → Project → Setup → Plan → Run → Verify → Extras → Done. Optional/inspectable lives behind `/`, `Tab`, `?`, or single-key drilldowns (`d` diff, `e` events, `l` logs, `m` MCP, `s` Slack).
4. **Receipts beat logs.** If we say "i'm wiring up your tracking now", we owe a one-line receipt: `wired useAmplitude() in 3 files · added 7 events · 8.2s`. Full log is `l` away.
5. **The agent narrates, the wizard reports.** Agent narration → WizardVoice line ("editing your layout..."). Tool completion → ledger (`✎ src/app/layout.tsx +12 −3`). Never mix.
6. **Calm > complete.** Hide 18 events behind `e`. Hide 40 tool calls behind `l`. Don't print everything "because the user might want it".

## Visual system

### Color palette (5 tokens, max)

| Token       | Truecolor                    | 16-color fallback | Use |
|-------------|------------------------------|-------------------|-----|
| `amp.blue`  | `#0052F2` / `#4083FF` on dark| `cyan`            | Primary, current step, CTA |
| `amp.lilac` | `#A78BFA`                    | `magenta`         | Extras: MCP, Slack, Session Replay |
| `amp.text`  | terminal default             | default           | Body text |
| `amp.muted` | `#7A7A85`                    | `gray` / `dim`    | Receipts, ledger, hints |
| `amp.red`   | `#F0506B`                    | `red`             | Fatal errors only |

Truecolor only when `COLORTERM === 'truecolor'`. No yellow/orange. Never rely on color alone.

### Typography

- Lowercase, first-person, present tense everywhere
- Capitalize proper nouns (Amplitude, Next.js, Slack) and quoted event names ("Signup Completed")
- Sentence case for labels. No emoji. No `!`.
- Numbers and code are monospace, unstyled

### Glyphs — safe set

`✓ ✗ ● ○ ◆ ▲ ▼ ❯ ⋯ │ ─ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼`

Braille spinner `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` on UTF-8, ASCII `|/-\` fallback. Rounded corners `╭ ╮ ╰ ╯` only when `supportsRoundedCorners()`; single-line otherwise. Never double-line.

### Spacing

Two-space indent inside boxes. Max content width 80 cols when terminal >=100 cols, else `cols - 4`. One blank between sections, never two. Hotkey rail always on last visible row.

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
| Done                   | `all set — you're tracking 7 events in production`     | —                                      |
| Recoverable error      | `couldn't reach the project list. retrying...`         | —                                      |
| Fatal error            | `i couldn't finish this. here's what to try:`          | (full error block)                     |
| Tab interrupt          | `what would you like me to do?`                        | (input cursor)                         |

Never: "TASK", "STEP", "PHASE", "INITIALIZING", "EXECUTING", emoji bullets, `!`, "Great!", "Awesome!", "Please".

## Cross-platform contract

| Terminal             | Truecolor | 256 | UTF-8 box | Braille | Rounded |
|----------------------|-----------|-----|-----------|---------|---------|
| iTerm2               | ✓         | ✓   | ✓         | ✓       | ✓       |
| Terminal.app         | —         | ✓   | ✓         | ✓       | ✓       |
| Windows Terminal     | ✓         | ✓   | ✓         | ✓       | ✓       |
| cmd.exe legacy       | —         | partial | CP437 | ✗       | ✗       |
| Alacritty/WezTerm    | ✓         | ✓   | ✓         | ✓       | ✓       |
| Ghostty              | ✓         | ✓   | ✓         | ✓       | ✓       |
| VS Code              | ✓         | ✓   | ✓         | ✓       | ✓       |
| SSH                  | varies    | usually ✓ | ✓     | ✓       | ✓       |
| CI (no TTY)          | text only |     |           |         |         |

Detection in `src/ui/tui/lib/terminalCapabilities.ts`. `--ci` flag forces ASCII + no color + no animation.

## Component vocabulary

| Component         | Role                                                     | Path                                                |
|-------------------|----------------------------------------------------------|-----------------------------------------------------|
| `StepIndicator`   | Welcome → Auth → Project → Plan → Run → Verify → Done    | `src/ui/tui/components/StepIndicator.tsx`           |
| `ScreenHotkeyBar` | Persistent bottom rail of contextual pills               | `src/ui/tui/components/ScreenHotkeyBar.tsx`         |
| `RunTimeline`     | Run-screen centerpiece                                   | `src/ui/tui/components/RunTimeline.tsx`             |
| `SlashPalette`    | `/` fuzzy command palette                                | `src/ui/tui/components/SlashPalette.tsx`            |
| `ProjectPicker`   | Fuzzy + column-scoped picker for thousands of projects   | `src/ui/tui/components/ProjectPicker.tsx`           |
| `ExtrasPanel`     | MCP + Slack + Session Replay tray                        | `src/ui/tui/components/ExtrasPanel.tsx`             |
| `AskBar`          | Tab-to-ask interruption input                            | `src/ui/tui/components/AskBar.tsx`                  |
| `WizardVoice`     | Canonical narration library                              | `src/ui/tui/lib/voice.ts`                           |
| `BrailleSpinner`  | Reused                                                   | existing                                            |
| `Sparkline`       | Reused on Verify                                         | existing                                            |
| `FileChangeLedger`| Reused inside RunTimeline                                | existing                                            |
| `DiffViewer`      | Opened by `d` / `/diff`                                  | existing                                            |
| `EventPlanViewer` | Opened by `e` / `/events`                                | existing                                            |

## What dies / what survives

**Survives**: all 20 screen files (refactored, not rewritten); existing primitives; `classifyPlanAgainstWiredCode`; `useTimedCoaching`; `src/lib/session`; nanostores store; all 13 slash commands; snake easter egg as `/snake`.

**Dies**: per-screen header/footer code; Logs and Snake RunScreen tabs (become `[l]` hotkey and `/snake` command); emoji bullets; `console.log` in screens; ad-hoc status strings.

**Born**: `WizardVoice`, `StepIndicator`, `ScreenHotkeyBar`, `RunTimeline`, `SlashPalette`, `ProjectPicker`, `ExtrasPanel`, `AskBar`, `terminalCapabilities.ts`.
