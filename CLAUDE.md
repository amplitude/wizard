# Amplitude Wizard — Agent Instructions

## What this project is

An interactive CLI (`npx @amplitude/wizard`) that instruments apps with Amplitude analytics. It authenticates the user, detects their framework, runs a Claude-powered agent (via Claude Agent SDK) to set up the SDK and events, and guides them through their first chart and dashboard.

The CLI behaves like Claude Code: a persistent prompt stays open throughout the session, and slash commands can be invoked at any time to change settings or trigger actions.

## Flows are the source of truth

The designed flows in [`docs/flows.md`](./docs/flows.md) define the intended user experience and should inform all implementation decisions. Before adding, changing, or removing any screen, step, or decision point, consult the flow diagrams. If you believe a flow needs to change, update `docs/flows.md` first and note it in your work.

The flows cover:

- **Wizard flow** — the main spine of the interactive TUI
- **Activation Check flow** — evaluates whether a returning user's project is ingesting events, and routes them accordingly
- **SUSI flow** — sign up / sign in, org and project selection for new users
- **Data Setup flow** — taxonomy agent, first chart, first dashboard after events are ingested
- **Org / Project Selection flow** — picker UI for switching org or project (reached via the framework-detection flow or the `/region` slash command's follow-up pickers)
- **Framework Detection flow** — auto-detect or manual selection, plus setup question disambiguation
- **Outro flow** — success, error, and cancel states after the agent run

## Architecture

### Entry points

- `bin.ts` — CLI entry point, yargs command definitions, mode flags (Node >=20 required by package metadata). Supports `--agent` (NDJSON machine output), `--ci`/`--yes` (non-interactive)
- `src/run.ts` — main wizard orchestration, ties TUI to session
- `src/ui/agent-ui.ts` — `AgentUI` — NDJSON `WizardUI` implementation for `--agent` mode. Auto-approves prompts, emits structured JSON events to stdout, redacts secrets from output

### TUI layer (`src/ui/tui/`)

Built with [Ink](https://github.com/vadimdemedes/ink) (React for CLIs) + nanostores for reactive state. Features journey stepper, keyboard hint bar, dissolve transitions, error boundaries, and resilience utilities.

| File / Dir | Role |
|------------|------|
| `App.tsx` | Root component — layout, screen resolution, `DissolveTransition`, `ScreenErrorBoundary` |
| `start-tui.ts` | Entry point — OSC terminal color detection, Ink app bootstrap |
| `ink-ui.ts` | `InkUI` — TUI `WizardUI` implementation, delegates to `WizardStore` |
| `store.ts` | `WizardStore`, `Screen`, `Overlay`, `Flow` — nanostore-backed reactive state |
| `router.ts` | `WizardRouter` — resolves active screen from session state via flow pipeline; manages overlay stack |
| `flows.ts` | Declarative flow pipelines (`Screen` + `Flow` enums, `FlowEntry` arrays) |
| `screen-registry.tsx` | Maps all 24 screen/overlay names (18 `Screen` + 6 `Overlay`) to React components |
| `screens/` | 17 screen components (Auth, Run, Outro, MCP, Slack, etc.) — `Screen.Options` resolves to `null` and has no component file |
| `components/` | `ConsoleView`, `JourneyStepper`, `HeaderBar`, `KeyHintBar`, `AmplitudeLogo`, `BrailleSpinner` |
| `hooks/` | `useWizardStore` (stable subscription), `useAsyncEffect` (AbortController-based), `useScreenInput`, `useEscapeBack`, `useStdoutDimensions` |
| `utils/` | `withTimeout`, `withRetry`, `classifyError`, `diagnostics` (flow evaluation + sanitized snapshots) |
| `styles.ts` | Design tokens and color palette |
| `console-commands.ts` | Slash command registration and dispatch |
| `context/` | React context providers |
| `primitives/` | Low-level UI building blocks |
| `services/` | TUI-specific service modules |

**Esc / back-navigation (Ink):**

- **`@inkjs/ui` `TextInput`** wires its own stdin handler; Esc does not surface as router back by default. Parent screens must use **`useScreenInput`** (or equivalent) if users should leave the step with Esc.
- **`ConfirmationInput`** maps Esc to **`onCancel`**. Combining it with **`useEscapeBack`** on the same surface causes double handling unless you gate **`useEscapeBack`** to phases without the confirm UI, or implement **`onCancel`** as “**`store.canGoBack()` → `store.goBack()`**, else skip/cancel” (see **`McpScreen`** / **`SlackScreen`**).
- Prefer **`useScreenInput`** over Ink’s raw **`useInput`** on wizard screens so input respects **`CommandModeContext`** while the slash command bar is active.

### Agent mode (`--agent`)

Machine-consumable execution mode for CI pipelines and agent orchestrators. Uses `AgentUI` (`src/ui/agent-ui.ts`) which implements `WizardUI` via NDJSON streaming to stdout. All prompts auto-approve. Stack traces and credentials are redacted from output. See `src/lib/mode-config.ts` for mode resolution logic and `src/lib/exit-codes.ts` for structured exit codes.

### Core business logic (`src/lib/`)

| File | Role |
|------|------|
| `wizard-session.ts` | `WizardSession` — single source of truth for all wizard state. Includes `RunPhase`, `McpOutcome`, `OutroKind`, etc. |
| `agent-interface.ts` | Creates and runs the Claude agent via `@anthropic-ai/claude-agent-sdk`. Configures MCP servers, hooks, model, permissions |
| `agent-runner.ts` | Universal agent-powered wizard runner. Orchestrates the full flow for any framework |
| `agent-hooks.ts` | Hook callbacks for agent lifecycle events (stop, tool use, etc.) |
| `framework-config.ts` | `FrameworkConfig<TContext>` interface — the contract every framework implements |
| `registry.ts` | `FRAMEWORK_REGISTRY` — maps `Integration` enum values to `FrameworkConfig` objects |
| `constants.ts` | `Integration` enum (detection/display order matters), env flags, URLs |
| `commandments.ts` | Wizard-wide system prompt rules always appended to the agent |
| `wizard-tools.ts` | In-process MCP server consumed by the wizard's own internal Claude agent. Tools: `check_env_keys`, `set_env_values`, `detect_package_manager`, `confirm_event_plan`, `confirm`, `choose`, `report_status`, `wizard_feedback` (plus `load_skill_menu` / `install_skill`, currently disabled — see comment in `createWizardToolsServer`). Distinct from `wizard-mcp-server.ts` below |
| `wizard-mcp-server.ts` | **External** stdio MCP server invoked via `amplitude-wizard mcp serve`. Read-only — wraps `agent-ops.ts` so third-party AI coding agents (Claude Code, Cursor, Codex) can call wizard ops as typed tools instead of parsing CLI stdout |
| `mcp-with-fallback.ts` | `callAmplitudeMcp<T>` — resilient MCP helper. Tries a direct HTTP call to the Amplitude MCP server; if it returns null or throws (e.g. tool removed), falls back to a minimal Claude agent with only the Amplitude MCP configured. Accepts `abortSignal` for clean exit handling. Use this for any new MCP-based data fetching. |
| `safe-tools.ts` | Allowlisted tools for the agent sandbox |
| `middleware/` | Benchmark pipeline, message schemas |
| `health-checks/` | Runtime health check utilities |
| `package-manager-detection.ts` | Detects npm/yarn/pnpm/bun/pip/etc. |
| `mode-config.ts` | `resolveMode()` — determines `ExecutionMode` (`interactive` / `ci` / `agent`) from CLI flags and TTY state |
| `exit-codes.ts` | `ExitCode` enum — structured exit codes (0 success, 2 invalid args, 3 auth, 4 network, 10 agent failed, 130 cancelled) |
| `session-checkpoint.ts` | Session checkpointing — saves/loads sanitized wizard state to a temp file for crash recovery. Zod-validated, 24-hour TTL, scoped per install directory |

### Framework integrations (`src/frameworks/`)

Each framework has its own directory containing a `*-wizard-agent.ts` file that exports a `FrameworkConfig`. Detection order is defined by the `Integration` enum in `constants.ts`.

**Supported frameworks:** Next.js, Vue, React Router, Django, Flask, FastAPI, Swift, React Native, Android, Flutter, Go, Java, Unreal, Unity, Python (fallback), JavaScript/Node (fallback), JavaScript/Web (fallback), Generic (ultimate fallback)

Adding a new framework? Mirror an existing framework under `src/frameworks/`
and its matching skill under `skills/integration/`, then follow the checklist
below.

### Skills (`skills/`)

Skills are bundled markdown-based instructions that the agent can follow during runs.

- `skills/integration/` — Per-framework SDK integration guides (step-by-step workflows with reference docs)
- `skills/instrumentation/` — Analytics instrumentation skills (event discovery, pattern matching, diff intake)
- `skills/taxonomy/` — Quickstart taxonomy agent and chart/dashboard planning skills

All three categories are owned and built by `amplitude/context-hub` and pulled into the wizard via `pnpm skills:refresh`. context-hub is the single source of truth: integration skills are generated from `transformation-config/`, taxonomy and instrumentation skills live in `context-hub/skills/`. Run `pnpm skills:refresh` to pull the latest from context-hub's GitHub release (or from a local `../context-hub/dist/skills/` build if that directory exists).

### Steps (`src/steps/`)

Post-agent discrete steps: MCP server installation into editors, env var upload, prettier formatting.

### Utilities (`src/utils/`)

OAuth flow, analytics tracking, env var handling, API key storage, debug logging, URL construction, package manager detection, shell completions, Anthropic status checks, custom headers.

**Logging — two distinct paths, don't confuse them:**

- `src/lib/observability/logger.ts` — **structured runtime logger**. Use this for diagnostic / debug / lifecycle logs that need to land in the per-project log file with redaction, run IDs, and correlation. Entry point: `createLogger('my-module')`. This is the canonical logger for new code in `src/lib/`, `src/ui/`, and `src/utils/`. It never calls `console.log` directly (Ink owns stdout in TUI mode).
- `src/utils/logging.ts` — **chalk-coloured terminal output**. Helpers (`green`, `red`, `dim`, `yellow`, `cyan`) for non-Ink CLI command UX (e.g. `amplitude-wizard login`, `whoami`). Calls `console.log` by design. Only appropriate in `src/commands/` and similar non-TUI command handlers.

If a callsite is inside the TUI or runs during a wizard session, prefer `observability/logger.ts`. Bare `console.log` in production source paths is an anti-pattern.

Key additions:
- `atomic-write.ts` — crash-safe JSON writes via temp-file + rename. Used by session checkpointing and config persistence.
- `token-refresh.ts` — silent OAuth token refresh using stored refresh tokens. Proactively refreshes 5 minutes before expiry, falls back to full browser auth on failure.
- `storage-paths.ts` — single source of truth for every path the wizard reads or writes. Per-user cache at `~/.amplitude/wizard/`, per-project metadata at `<installDir>/.amplitude/`. Override the cache root with `AMPLITUDE_WIZARD_CACHE_DIR` (used by tests).
- `storage-migration.ts` — one-shot migration from the old `$TMPDIR/amplitude-wizard-*` + project-root dotfile layout. Idempotent, runs at startup. Drop after one release.

## Session storage

The wizard persists state across several layers, each with different scope and lifetime:

| Layer | File / Location | Scope | Lifetime | Contents |
|-------|----------------|-------|----------|----------|
| **OAuth tokens** | `~/.amplitude/wizard/oauth-session.json` (legacy read: `~/.ampli.json`) | Per user | Until expiry (silent refresh via `token-refresh.ts`) | Access token, refresh token, expiry timestamp. Written with `atomicWriteJSON()` at `0o600`. |
| **API key store** | `~/.amplitude/wizard/credentials.json` (fallback `<project>/.env.local`) | Per project | Persistent | Amplitude project API key. Mode `0o600`, keyed by hashed install-dir. Replaces the previous keychain backend, which triggered an OS unlock prompt on every launch. |
| **Per-project debug log** | `~/.amplitude/wizard/runs/<sha256(installDir)>/log.txt` (+ `log.ndjson`) | Per project | 5 MB rotation | Structured wizard logs. Two parallel runs in different directories no longer collide. |
| **Session checkpoint** | `~/.amplitude/wizard/runs/<sha256(installDir)>/checkpoint.json` | Per install directory | 24 hours | Intro state, region, org/project selection, framework detection. Zod-validated on load. No credentials. |
| **Plans + agent state** | `~/.amplitude/wizard/plans/<planId>.json`, `~/.amplitude/wizard/state/<attemptId>.json` | Per plan / per attempt | 24 h / per-run | `wizard plan` output and agent compaction-recovery snapshots. |
| **Project metadata** | `<installDir>/.amplitude/events.json`, `<installDir>/.amplitude/project-binding.json`, `<installDir>/.amplitude/dashboard.json` (dashboard path gitignored; `ampli.json` mirror during transition) | Per project | Persistent | Approved event plan + org/project binding + dashboard URL. |
| **In-memory store** | `WizardStore` (nanostores) | Per run | Process lifetime | Full session state, tasks, prompts, overlays, UI state |

The `/diagnostics` slash command prints the full layout for the current project — useful when filing a bug report.

**Security invariants:**
- Credential files use `0o600` permissions (owner read/write only)
- Security- and recovery-sensitive JSON uses `atomicWriteJSON()` (temp-file + rename) so a crash mid-write leaves the prior file intact — including OAuth tokens, API key store, checkpoints, plans, agent recovery snapshots, and update-check cache. Append-only logs (`log.txt` / `log.ndjson`), directory creation, streamed or editor-facing writes, and intentional exceptions (e.g. `.env.local` handling per platform/editor constraints) are outside that contract. Concurrent wizard runs coordinate via the apply lock (separate from JSON atomic writes).
- Checkpoint files never contain tokens, API keys, or access tokens
- Config scoping validates org ID against live data to prevent cross-project leakage
- Zone priority: CLI flag > env var > stored config (prevents env var pollution across projects)

## Pull requests

- Run the **`/reflect`** skill on the session and paste the numbered checklist into the PR description (or link to it). Treat that as part of the PR artifact, not optional narration. Human-oriented PR steps also live in [`CONTRIBUTING.md`](./CONTRIBUTING.md). When running **`/reflect`**, treat **this repo’s `CLAUDE.md`** as the canonical place to de-dupe proposals — a global `~/.claude/CLAUDE.md` may be absent in worktrees or sandboxes.
- If **`git status`** shows your branch is **behind** its upstream (e.g. `origin/your-branch`), run **`git pull --rebase origin <branch>`** before **`git push`** so the push is fast-forward and history stays linear.
- After you **`git push`** a branch, prefer opening the PR with the GitHub CLI: **`gh pr create --fill`** (or pass `--title` / `--body` explicitly). If `gh` is not installed or authenticated, use the compare URL your `git push` printed instead.
- After changing **`src/ui/tui/`** screens, **`flows.ts`**, **`router.ts`**, or **`store.ts`** navigation-related code, run Vitest in a stable pool before pushing (avoids fork timeouts / flakes on wide runs):

  ```bash
  pnpm exec vitest run --pool=forks --maxWorkers=1 \
    src/ui/tui/__tests__/router.test.ts \
    src/ui/tui/__tests__/flow-invariants.test.ts
  ```

  Add any **`src/ui/tui/screens/__tests__/`** files that cover screens you edited.

## Commit conventions

This repo enforces **conventional commit** PR titles and commit messages. The type prefix must be one of: `feat`, `fix`, `docs`, `test`, `ci`, `refactor`, `perf`, `chore`, `revert`. Example: `feat: add org picker to auth flow`.

## Analytics conventions

- **Property-key naming.** Event properties, user properties, and group-identify keys are all lowercase-with-spaces: `'org id'`, `'project id'`, `'project name'`, `'duration ms'`, `'error message'`, `'detected framework'`. When adding a new `wizardCapture` / `captureWizardError` call, spell multi-word keys as quoted strings — don't use TypeScript property shorthand (`{ durationMs }`) for multi-word names. Single-word keys (`integration`, `status`, `attempt`, `region`, `mode`) and Amplitude-reserved keys starting with `$` (`$app_name`, `$error`) pass through untouched. Note: these replaced the older `workspace_id` / `workspace_name` keys as part of the workspace → project rename.
- **Group analytics.** Every event is automatically associated with the `'org id'` group via `setGroup()` inside `identifyUser()` (`src/utils/analytics.ts`). Do **not** re-pass `orgId` per event.
- **Dev vs prod telemetry.** Local dev runs (`NODE_ENV=development`, set by `pnpm try` / `pnpm dev`) route telemetry to the dev Amplitude project. Prod builds use the production key. Both keys mirror the App API's ampli config and point at the main `amplitude/Amplitude` project — same one the rest of the Amplitude app writes to.

## Key conventions

- **Screens are passive.** Screens observe session state and render accordingly. They do not own navigation logic — the router derives the active screen from session state.
- **Session is the single source of truth.** All state lives in `WizardSession`. Screens and steps read from and write to the session; they do not communicate directly.
- **Flows are declarative.** Each flow is a pipeline of `{ screen, show, isComplete }` entries. Navigation advances automatically when `isComplete` returns true.
- **Overlays interrupt without breaking flow.** `OutageScreen` and other overlays are pushed onto an overlay stack and popped when resolved, resuming the flow where it left off. Overlay enum (`src/ui/tui/router.ts`): `Outage`, `Snake`, `Mcp`, `Slack`, `Logout`, `Login`.
- **Slash commands are always available.** `/region`, `/login`, `/logout`, `/whoami`, `/create-project`, `/mcp`, `/slack`, `/feedback`, `/clear`, `/help`, `/debug`, `/diagnostics`, `/snake`, `/exit` must be interceptable at any point in the session. The canonical list lives in `src/ui/tui/console-commands.ts` — update both together.
- **Framework configs are data-driven.** No switch statements or per-framework routing. Everything goes through `FrameworkConfig` + `FRAMEWORK_REGISTRY`. The universal runner handles all shared behavior.
- **Agent commandments** (`src/lib/commandments.ts`) are always injected as system prompt. Key rules: never hardcode secrets, always use `wizard-tools` MCP for env vars and package manager detection, must call `confirm_event_plan` before writing `track()` calls.
- **Detection order matters.** The `Integration` enum order in `constants.ts` controls both auto-detection priority (first match wins) and display order in the CLI select menu.

## Development commands

```bash
pnpm try           # run the wizard locally (from source, no build needed)
pnpm try --agent   # run in agent mode (NDJSON output, auto-approve)
pnpm try --yes     # run in CI mode (alias for --ci, non-interactive)
pnpm build         # compile TypeScript
pnpm test          # run unit tests (vitest)
pnpm test:watch    # run unit tests in watch mode
pnpm test:bdd      # run BDD/Cucumber tests (features/*.feature)
pnpm test:e2e      # build + run e2e tests
pnpm test:proxy    # validate proxy health, models, streaming
pnpm lint          # run prettier + eslint checks
pnpm fix           # auto-fix lint issues
pnpm flows         # render docs/flows.md diagrams to docs/diagrams/
pnpm skills:refresh # pull all skills from context-hub (integration, instrumentation, taxonomy)
```

## Testing

- **Focused TUI runs:** when iterating on Ink screens or the router, prefer  
  `pnpm exec vitest run --pool=forks --maxWorkers=1 <paths…>`  
  so workers stay predictable; use full `pnpm test` before merge when practical.
- **Unit tests:** `src/**/__tests__/` — vitest, run with `pnpm test`
- **Router + flow tests:** `src/ui/tui/__tests__/router.test.ts` — parameterized router resolution tests. `src/ui/tui/__tests__/flow-invariants.test.ts` — fast-check property-based tests verifying flow invariants (24 tests: no backward navigation, unauthenticated users never see Run, error state skips post-success screens, etc.)
- **BDD tests:** `features/` — Cucumber.js feature files and step definitions, run with `pnpm test:bdd`
- **E2e tests:** `e2e-tests/` — build + run against test applications in `e2e-tests/test-applications/`
- **Proxy tests:** `vitest.config.proxy.ts` — validate LLM proxy connectivity

## CI/CD

GitHub Actions workflows in `.github/workflows/`:

- `build.yml` — build + unit tests on push/PR
- `behavior-driven-tests.yml` — BDD tests on push/PR
- `pr-conventional-commit.yml` — enforces conventional commit PR titles
- `publish.yml` — npm publish flow
- `release-please.yml` — automated release PRs
- `refresh-instrumentation-skills.yml` / `refresh-integration-skills.yml` — skill refresh automation

## Key docs

- [`docs/flows.md`](./docs/flows.md) — flow diagrams (source of truth for UX)
- [`docs/architecture.md`](./docs/architecture.md) — high-level architecture overview
- [`docs/dual-mode-architecture.md`](./docs/dual-mode-architecture.md) — TUI + agent + CI mode architecture
- [`docs/mcp-installation.md`](./docs/mcp-installation.md) — how MCP server installation works across editors
- [`docs/critical-files.md`](./docs/critical-files.md) — files ranked by blast radius
- [`docs/engineering-patterns.md`](./docs/engineering-patterns.md) — async safety, retry, error classification patterns
- [`docs/external-services.md`](./docs/external-services.md) — third-party services the wizard talks to
- [`docs/ux-improvements.md`](./docs/ux-improvements.md) — UX backlog and recently-shipped polish
- [`docs/releasing.md`](./docs/releasing.md) — release process and versioning
