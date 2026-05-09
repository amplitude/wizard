# TUI Redesign Mocks

Visual proposal for a refreshed wizard TUI that adopts Claude Code's calm, prompt-centric look while keeping Amplitude brand alignment and modern terminal-app conventions.

> **How these images were made.**
> The "current" PNGs are real `lastFrame()` captures from `ink-testing-library`, with their ANSI escapes preserved and replayed through a Brand-aware HTML renderer. The "proposed" PNGs are hand-styled HTML built from the same `Brand` tokens in [`src/ui/tui/styles.ts`](../src/ui/tui/styles.ts). Both halves render through Playwright at 2× device pixel ratio with DejaVu Sans Mono.
>
> Re-generate everything with:
> ```bash
> FORCE_COLOR=3 pnpm exec vitest run src/ui/tui/__tests__/capture-current-screens.test.tsx
> node scripts/render-tui-mocks.mjs
> ```
>
> The text-only ASCII captures live at [`docs/_tui-current-state.md`](./_tui-current-state.md). The PNG sources live under `docs/mocks/{current,proposed}/`.

---

## 1. Goals

| Goal | What changes |
|---|---|
| **Match Claude Code's look** | Left-aligned content, single accent color, sparse chrome, prompt at the bottom, brand pinned to the top-left only. |
| **Industry best practices** | No centered text, no decorative emoji, consistent picker chevron, single hint bar, bold heading + dim subtitle pattern, density over padding. |
| **Keep Amplitude brand** | Lilac/blue accent retained for active state; brand stripe (`▎`) prefixes the top bar; existing `Brand` palette in `styles.ts` reused unchanged. |

## 2. Design principles

1. **One focal point per screen.** Heading, body, action — in that order. Decorative panels (Discovered facts, marketing taglines) move to a sidebar or get demoted to a single line.
2. **Left-aligned everything.** Centered ASCII text reads as "wizard from 2008." Modern TUIs (Claude Code, `gh dash`, `lazygit`, `bun create`) align flush left with a 2-space gutter.
3. **Persistent thin chrome.** A single 1-line top bar (brand + journey + breadcrumb) and a single 1-line bottom hint bar. No banners, no double separators.
4. **One accent color in motion.** Brand violet for active picker rows and in-progress task bullets; brand lilac for completed; brand blue for links; everything else is gray-scale text.
5. **No emoji in load-bearing UI.** `🎉` and `💬` move out of headings; replaced by `✓` and plain text. Emoji read as cute, not professional, and break alignment in monospace.
6. **Picker chevron, not bracketed numbers.** `❯ Sign in` instead of `▸ [1] Continue — sign in to Amplitude (existing account)`. Numbers move to a right-margin hint in dim gray.
7. **Density.** Pre-run summary, target line, and tagline collapse into the top bar. Trim trailing blank lines that pad screens to 6+ rows of empty space.

---

## 3. Per-screen comparisons

Each subsection shows the **current** rendering on top and the **proposed** rendering below it, both in the same Brand palette so the comparison is fair.

### 3.1 IntroScreen — detecting

Current

![current IntroScreen detecting](mocks/current/IntroScreen__detecting.png)

Proposed

![proposed IntroScreen detecting](mocks/proposed/IntroScreen__detecting.png)

The big banner is gone — the top bar already says "amplitude wizard." Target path is the spinner's subject, not a separate row. Subtitle explains *what* we're scanning for, removing the user's "is it stuck?" anxiety.

### 3.2 IntroScreen — detected (Next.js)

Current

![current IntroScreen detected](mocks/current/IntroScreen__detected-Next-js.png)

Proposed

![proposed IntroScreen detected](mocks/proposed/IntroScreen__detected.png)

Heading carries Target + Framework + glyph in one line. The "Sign in to an existing Amplitude account, or create a new one" sub-heading is dropped — the picker options speak for themselves. Bracketed `[1]…[5]` numbers move to a dim right margin so they're available as keypresses without dominating the labels.

### 3.3 IntroScreen — generic fallback

Current

![current IntroScreen generic](mocks/current/IntroScreen__generic-fallback.png)

The generic-fallback variant of the proposed design is identical to "detected" with the framework row omitted and a one-line "No framework detected — continue with the generic guide or pick one below." subtitle.

### 3.4 IntroScreen — welcome back (returning user)

Current

![current IntroScreen welcome back](mocks/current/IntroScreen__welcome-back-returning-user.png)

Proposed

![proposed IntroScreen welcome back](mocks/proposed/IntroScreen__welcome-back.png)

Three condensed rows replace the eight in the current version. The "Next: install the SDK…" coaching line is dropped — returning users have already seen it. Sign-in confirmation moves to the picker label ("Continue to workspace setup" implies "still you").

### 3.5 IntroScreen — resume from checkpoint

Current

![current IntroScreen resume](mocks/current/IntroScreen__resume-from-checkpoint.png)

Proposed

![proposed IntroScreen resume](mocks/proposed/IntroScreen__resume-checkpoint.png)

Two-column key/value table for the saved-state fields aligns with the "Discovered" list later in the run; consistent visual language across screens.

### 3.6 SetupScreen — detecting configuration

Current

![current SetupScreen detecting](mocks/current/SetupScreen__detecting.png)

Proposed

![proposed SetupScreen detecting](mocks/proposed/SetupScreen__detecting.png)

Body line *says why the user is being asked* (detection running) — currently the screen is just one bare line of text.

### 3.7 AuthScreen — OAuth waiting

Current

![current AuthScreen oauth](mocks/current/AuthScreen__OAuth-waiting.png)

Proposed

![proposed AuthScreen oauth](mocks/proposed/AuthScreen__oauth.png)

Per-screen hints fold into the bottom hint bar (lowercase, `·`-separated). URL gets one row of breathing room above and below — currently it's tight against the heading.

### 3.8 AuthScreen — org picker

Current

![current AuthScreen org](mocks/current/AuthScreen__org-picker.png)

Proposed

![proposed AuthScreen org](mocks/proposed/AuthScreen__org.png)

Same picker convention as IntroScreen. The trailing blank line under the heading goes away — Ink already adds one row of margin via `marginBottom={1}`.

### 3.9 AuthScreen — project picker

Current

![current AuthScreen project](mocks/current/AuthScreen__project-picker.png)

Proposed

![proposed AuthScreen project](mocks/proposed/AuthScreen__project.png)

The "completed step" pin shortens to `✓ Organization · Acme Corp` to match the breadcrumb in the top bar. Synthetic actions ("Create new", "Start over") get a leading glyph (`+`, `↩`) to visually distinguish them from real choices.

### 3.10 RegionSelectScreen — first-time picker

Current

![current RegionSelectScreen](mocks/current/RegionSelectScreen__first-time-picker.png)

Proposed

![proposed RegionSelectScreen](mocks/proposed/RegionSelectScreen__first-time.png)

Two-column picker labels (option name + endpoint) align like the resume-checkpoint table. The dot-bullet footer becomes plain dim text — bullet glyphs are reserved for real picker rows, not advisories.

### 3.11 SignupEmailScreen — empty input

Current

![current SignupEmailScreen](mocks/current/SignupEmailScreen__empty-input.png)

Proposed

![proposed SignupEmailScreen](mocks/proposed/SignupEmailScreen__empty.png)

The `❯` prefix marks the active text input. The placeholder appears below the cursor in dim text — same pattern as Claude Code's prompt placeholder.

### 3.12 SigningUpScreen — checking account

Current

![current SigningUpScreen](mocks/current/SigningUpScreen__checking-account.png)

Proposed

![proposed SigningUpScreen](mocks/proposed/SigningUpScreen__checking.png)

Spinner row drops the leading `·` and the redundant trailing `…` — the spinner glyph already conveys "in progress."

### 3.13 SignupFullNameScreen — empty input

Current

![current SignupFullNameScreen](mocks/current/SignupFullNameScreen__empty-input.png)

Proposed

![proposed SignupFullNameScreen](mocks/proposed/SignupFullNameScreen__empty.png)

Same input pattern as SignupEmailScreen.

### 3.14 ToSScreen — terms picker

Current

![current ToSScreen](mocks/current/ToSScreen__terms-picker.png)

Proposed

![proposed ToSScreen](mocks/proposed/ToSScreen__terms.png)

The double-statement of intent ("By continuing… / Please review…") collapses to one line. The two URLs become a key/value table. Picker labels are stripped to verb form; the "I accept the Terms of Service and Privacy Policy" mouthful was already redundant given the heading.

### 3.15 CreateProjectScreen — idle prompt

Current

![current CreateProjectScreen](mocks/current/CreateProjectScreen__idle-prompt.png)

Proposed

![proposed CreateProjectScreen](mocks/proposed/CreateProjectScreen__idle.png)

The `· Press Enter to create, Esc to go back.` footer is redundant with the bottom hint bar (which already shows `enter create · esc back`). Drop it.

### 3.16 DataSetupScreen — analyzing project

Current

![current DataSetupScreen](mocks/current/DataSetupScreen__analyzing-project.png)

Proposed

![proposed DataSetupScreen](mocks/proposed/DataSetupScreen__analyzing.png)

Three rows collapse to two — heading is folded into the spinner subject.

### 3.17 ActivationOptionsScreen — installed, waiting for events

Current

![current ActivationOptionsScreen](mocks/current/ActivationOptionsScreen__installed-waiting-for-events.png)

Proposed

![proposed ActivationOptionsScreen](mocks/proposed/ActivationOptionsScreen__waiting.png)

Each picker row gets a primary action (left) and a dim hint (right), aligned at the same column. Reads as a menu, not a paragraph. The "I'm blocked"/"I'm done" first-person framing becomes neutral verb-form to match the rest of the wizard.

### 3.18 RunScreen — cold start

The highest-stakes screen — users stare at it for the entire agent run.

Current

![current RunScreen](mocks/current/RunScreen__cold-start-first-task-in-progress.png)

Proposed

![proposed RunScreen](mocks/proposed/RunScreen__cold-start.png)

Changes
- **Heading carries setup target.** "Setting up Amplitude in Next.js" replaces the missing heading on the current screen. Right-aligned counter `0/4 · 55s · cold start` collapses three current rows.
- **Discovered moves to a side column** on wide terminals. The "·  5 facts" header and `✓` row glyphs go away; the fact list reads as a key/value table.
- **Task glyphs unify with the journey stepper.** `◐` (in-progress) replaces the `›` arrow; `○` for pending; `●` for done. Same as the stepper.
- **Status line is plain text with a leading spinner.** `◇` glyph dropped — the spinner conveys "live", and a static diamond next to a static label was redundant.
- **Tab bar uses dim dashes as separators**, with the active tab in lilac. The current tab bar's `Snake (WASD)` reads as a typo; the new one drops parens.

### 3.19 McpScreen — looking for AI tools

Current

![current McpScreen](mocks/current/McpScreen__looking-for-AI-tools.png)

Proposed

![proposed McpScreen](mocks/proposed/McpScreen__looking.png)

`💬` dropped (industry best practice; emoji break alignment in monospace). Body is one paragraph instead of three, with the example moved inline.

### 3.20 DataIngestionCheckScreen — listening for events

Current

![current DataIngestionCheckScreen](mocks/current/DataIngestionCheckScreen__listening-for-events.png)

Proposed

![proposed DataIngestionCheckScreen](mocks/proposed/DataIngestionCheckScreen__listening.png)

Heading is action-led ("Trigger some events" is what we want the user to *do*). Three near-identical messages ("Start your app", "Start your dev server", "Once you interact…") collapse to one. Restart reminder demoted to a "heads up" footnote.

### 3.21 SlackScreen — connect prompt

Current

![current SlackScreen](mocks/current/SlackScreen__connect-prompt.png)

Proposed

![proposed SlackScreen](mocks/proposed/SlackScreen__connect.png)

Heading is a verb. The "Connect the 'Amplitude' Slack app to your workspace?" question is folded into the verb-form picker — currently the screen has both, which doubles the read.

### 3.22 LogoutScreen — confirm

Current

![current LogoutScreen](mocks/current/LogoutScreen__confirm-prompt.png)

Proposed

![proposed LogoutScreen](mocks/proposed/LogoutScreen__confirm.png)

Question form replaced by a description. The current "?" mid-screen confuses Esc behavior — esc-cancel and "click Cancel" mean the same thing, both should land here.

### 3.23 LoginScreen — refreshing credentials

Current

![current LoginScreen](mocks/current/LoginScreen__refreshing-credentials.png)

Proposed

![proposed LoginScreen](mocks/proposed/LoginScreen__refreshing.png)

Explicit "Trying to refresh stored credentials" subtitle gives the user something to read while it spins (the current screen has 2-3 seconds of dead text).

### 3.24 OutroScreen — success

Current

![current OutroScreen success](mocks/current/OutroScreen__success.png)

Proposed

![proposed OutroScreen success](mocks/proposed/OutroScreen__success.png)

`🎉` dropped — `✓` in success-green is the modern equivalent. Setup duration surfaces here (currently nowhere). Changes use `+` (additive), aligning with diff conventions and reusing the picker hint-column pattern.

### 3.25 OutroScreen — error

Current

![current OutroScreen error](mocks/current/OutroScreen__error.png)

Proposed

![proposed OutroScreen error](mocks/proposed/OutroScreen__error.png)

"Try these" replaces the bare `→` list. Each row has a primary action and a right-aligned single-key hint, mirroring the picker convention.

### 3.26 OutroScreen — cancel

Current

![current OutroScreen cancel](mocks/current/OutroScreen__cancel.png)

Proposed

![proposed OutroScreen cancel](mocks/proposed/OutroScreen__cancel.png)

The `─ Setup cancelled` heading-glyph is non-semantic (a horizontal rule rendered as a heading is confusing); drop it. The redundant "Setup cancelled." sentence under a heading that already says "Setup cancelled" is dropped.

### 3.27 OutageScreen — degraded services

Current

![current OutageScreen](mocks/current/OutageScreen__degraded-services.png)

Proposed

![proposed OutageScreen](mocks/proposed/OutageScreen__degraded.png)

`◆` (filled diamond, brand glyph) is reserved for the brand mark in the top bar. `⚠` reads as warning. The "Status:" / "Status page:" label pair becomes a single key/value row. Picker labels lose their `[Enter]`/`[Esc]` annotations — the bottom hint bar already shows them.

---

## 4. Color spec (no change to the palette, just usage rules)

| Role | Token | Used for |
|---|---|---|
| **Brand stripe** | `Brand.lilac` | The `▎` in the top-left of the top bar. |
| **Active picker chevron** | `Brand.violet` (`Colors.active`) | `❯` in front of the highlighted picker row. |
| **In-progress** | `Brand.violet` (`Colors.active`) | `◐` task glyph, journey-stepper active dot. |
| **Completed** | `Brand.lilac` (`Colors.accentSecondary`) | `●`/`✓` task glyph, completed step in stepper. |
| **Pending** | `Colors.muted` | `○` task glyph, future step in stepper. |
| **Heading** | `Colors.heading` (Gray 10) | Bold first row of every screen. |
| **Body** | `Colors.body` (Gray 30) | Subtitle, picker labels, key/value cells. |
| **Hint / muted** | `Colors.muted` (Gray 50) | Right-column hint text, advisories, bottom hint bar. |
| **Success** | `Colors.success` | `✓` in OutroScreen (success), Slack confirmed, etc. |
| **Error** | `Colors.error` | `✗` in OutroScreen (error), validation messages. |
| **Warning** | `Colors.warning` | `⚠` heading prefix on OutageScreen + IntroScreen "no manifest" advisory. |
| **Border** | `Colors.border` | The single `─` separator under the top bar. |

---

## 5. Phasing suggestion

If we want to ship this incrementally rather than as one big PR:

1. **Chrome only.** New top bar + bottom hint bar. Every screen still works because `App.tsx` already isolates chrome from content.
2. **Picker primitive.** Replace `▸ [n]` with `❯` + right-aligned key hints. One change in `PickerMenu` flips every screen.
3. **Per-screen content rewrites.** IntroScreen → AuthScreen → RunScreen → OutroScreen (highest blast-radius first), then the rest.
4. **Glyph language.** Unify `◐`/`○`/`●` across stepper, task list, and discovery.

Step 1 gets ~60% of the perceived "new look" with ~10% of the diff — if we want to test the new chrome early, that's the cheapest change.

---

## 6. Open questions

- **Keep journey stepper labels on narrow terminals?** Currently ≥60 cols shows labels, <60 shows dots. Proposal collapses labels at <100 cols (because the breadcrumb is sharing the row). Worth confirming we don't lose accessibility.
- **`▎` brand glyph.** Renders as a thin vertical bar in most terminal fonts; some legacy fonts (Consolas in Windows Terminal pre-2021) render it as a full-width block. Need to test or fall back to `│` if unsupported.
- **Emoji removal.** `🎉` and `💬` are user-visible removals. Worth running by Marketing — the wizard's success state landing as "✓ Amplitude is live" is more sober than current; some teams prefer the celebration. Easy to keep emoji as an opt-in under `--celebrate` if desired.
