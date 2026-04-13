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
- **Data Setup flow** — taxonomy agent, first chart, first dashboard checklist after events are ingested
- **Org / Project Selection flow** — picker UI for switching org or project, also used by `/org` and `/project` slash commands
- **Framework Detection flow** — auto-detect or manual selection, plus setup question disambiguation
- **Outro flow** — success, error, and cancel states after the agent run

## Architecture

### Entry points

- `bin.ts` — CLI entry point, yargs command definitions, mode flags (Node >=18.17.0 required). Supports `--tui-v2` (parallel TUI), `--agent` (NDJSON machine output), `--ci` / `--yes` (non-interactive)
- `src/run.ts` — main wizard orchestration, ties TUI to session
- `src/ui/agent-ui.ts` — `AgentUI` — NDJSON `WizardUI` implementation for `--agent` mode. Auto-approves prompts, emits structured JSON events to stdout, redacts secrets from output

### TUI layer (`src/ui/tui/`) — v1

Built with [Ink](https://github.com/vadimdemedes/ink) (React for CLIs) + nanostores for reactive state. This is the default TUI; v2 runs in parallel behind the `--tui-v2` flag (see below).

| File | Role |
|------|------|
| `router.ts` | `WizardRouter` — resolves active screen from session state via flow pipeline; manages overlay stack |
| `flows.ts` | Declarative flow pipelines (`Screen` + `Flow` enums, `FlowEntry` arrays). Owns `Screen` and `Flow` enums |
| `store.ts` | Nanostore-backed reactive store, synced to React via `useSyncExternalStore` |
| `screens/` | One file per screen (16 screens total: Intro, Auth, Setup, Run, Outro, etc.) |
| `components/` | Shared UI components |
| `primitives/` | Low-level UI building blocks |
| `console-commands.ts` | Slash command registration and dispatch |
| `screen-registry.tsx` | Maps `Screen`/`Overlay` names to React components |
| `services/` | TUI-specific service modules |

### TUI layer (`src/ui/tui-v2/`) — v2 (parallel pipeline, `--tui-v2`)

Redesigned TUI with improved UX: journey stepper, keyboard hint bar, dissolve transitions, error boundaries, and resilience utilities. Currently behind the `--tui-v2` flag. Re-exports `store.ts`, `router.ts`, and `flows.ts` from v1 as bridge files; owns its own screens, components, hooks, and utilities. See [`docs/tui-v1-to-v2-migration.md`](./docs/tui-v1-to-v2-migration.md) for the plan to make v2 the default and eventually remove v1.

| File / Dir | Role |
|------------|------|
| `App.tsx` | Root component — layout, screen resolution, `DissolveTransition`, `ScreenErrorBoundary` |
| `start-tui.ts` | Entry point — OSC terminal color detection, Ink app bootstrap |
| `ink-ui.ts` | Re-exports v1 `InkUI` (bridge file) |
| `store.ts` | Re-exports v1 `WizardStore`, `Screen`, `Overlay`, `Flow`, etc. (bridge file) |
| `router.ts` | Re-exports v1 `WizardRouter` (bridge file) |
| `flows.ts` | Re-exports v1 `FLOWS` (bridge file) |
| `screen-registry.tsx` | Maps all 23 screen/overlay names to v2 React components |
| `screens/` | 16 v2 screen components (Auth, Run, Outro, MCP, Slack, etc.) |
| `components/` | `ConsoleView`, `JourneyStepper`, `HeaderBar`, `KeyHintBar`, `AmplitudeLogo`, `BrailleSpinner` |
| `hooks/` | `useWizardStore` (stable subscription), `useAsyncEffect` (AbortController-based), `useScreenInput`, `useStdoutDimensions` |
| `utils/` | `withTimeout`, `withRetry`, `classifyError`, `diagnostics` (flow evaluation + sanitized snapshots) |
| `styles.ts` | Design tokens and color palette |
| `console-commands.ts` | v2 slash command registration |
| `context/` | React context providers |
| `primitives/` | Low-level UI building blocks |
| `services/` | TUI-specific service modules |

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
| `wizard-tools.ts` | In-process MCP server providing `check_env_keys`, `set_env_values`, `detect_package_manager`, `confirm_event_plan` |
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

Adding a new framework? Use the `adding-framework-support` skill (`.claude/skills/adding-framework-support/SKILL.md`).

### Skills (`skills/`)

Skills are bundled markdown-based instructions that the agent can follow during runs.

- `skills/integration/` — Per-framework SDK integration guides (step-by-step workflows with reference docs)
- `skills/instrumentation/` — Analytics instrumentation skills (event discovery, pattern matching, diff intake)
- `skills/taxonomy/` — Quickstart taxonomy agent (`amplitude-quickstart-taxonomy-agent`) for event naming, starter-kit scoping, and UrlEventSuggesterResponse-shaped JSON plans

Skills under `skills/instrumentation/` are refreshed via `pnpm skills:refresh`. Taxonomy skills ship only in-repo.

### Steps (`src/steps/`)

Post-agent discrete steps: MCP server installation into editors, env var upload, prettier formatting.

### Utilities (`src/utils/`)

OAuth flow, analytics tracking, env var handling, API key storage, debug logging, URL construction, package manager detection, shell completions, Anthropic status checks, custom headers.

Key additions:
- `atomic-write.ts` — crash-safe JSON writes via temp-file + rename. Used by session checkpointing and config persistence.
- `token-refresh.ts` — silent OAuth token refresh using stored refresh tokens. Proactively refreshes 5 minutes before expiry, falls back to full browser auth on failure.

## Session storage

The wizard persists state across four layers, each with different scope and lifetime:

| Layer | File / Location | Scope | Lifetime | Contents |
|-------|----------------|-------|----------|----------|
| **OAuth tokens** | `~/.ampli.json` | Per user | Until expiry (silent refresh via `token-refresh.ts`) | Access token, refresh token, expiry timestamp. Written with `atomicWriteJSON()`. |
| **API key store** | `~/.ampli.json` + project `.env.local` | Per project | Persistent | API key, org/workspace/project selection, region |
| **Session checkpoint** | `$TMPDIR/amplitude-wizard-checkpoint.json` | Per install directory | 24 hours | Intro state, region, org/workspace selection, framework detection. Zod-validated on load. No credentials. |
| **In-memory store** | `WizardStore` (nanostores) | Per run | Process lifetime | Full session state, tasks, prompts, overlays, UI state |

**Security invariants:**
- Credential files use `0o600` permissions (owner read/write only)
- All file writes use `atomicWriteJSON()` (temp-file + rename) to prevent corruption on crash
- Checkpoint files never contain tokens, API keys, or access tokens
- Config scoping validates org ID against live data to prevent cross-project leakage
- Zone priority: CLI flag > env var > stored config (prevents env var pollution across projects)

## Commit conventions

This repo enforces **conventional commit** PR titles and commit messages. The type prefix must be one of: `feat`, `fix`, `docs`, `test`, `ci`, `refactor`, `perf`, `chore`, `revert`. Example: `feat: add org picker to auth flow`.

## Key conventions

- **Screens are passive.** Screens observe session state and render accordingly. They do not own navigation logic — the router derives the active screen from session state.
- **Session is the single source of truth.** All state lives in `WizardSession`. Screens and steps read from and write to the session; they do not communicate directly.
- **Flows are declarative.** Each flow is a pipeline of `{ screen, show, isComplete }` entries. Navigation advances automatically when `isComplete` returns true.
- **Overlays interrupt without breaking flow.** `OutageScreen` and `SettingsOverrideScreen` are pushed onto an overlay stack and popped when resolved, resuming the flow where it left off. Overlay enum: `Outage`, `SettingsOverride`, `Snake`, `Mcp`, `Slack`, `Logout`, `Login`.
- **Slash commands are always available.** `/org`, `/project`, `/region`, `/login`, `/logout`, `/whoami`, `/chart`, `/dashboard`, `/taxonomy`, `/slack`, `/feedback`, `/help` must be interceptable at any point in the session.
- **Framework configs are data-driven.** No switch statements or per-framework routing. Everything goes through `FrameworkConfig` + `FRAMEWORK_REGISTRY`. The universal runner handles all shared behavior.
- **Agent commandments** (`src/lib/commandments.ts`) are always injected as system prompt. Key rules: never hardcode secrets, always use `wizard-tools` MCP for env vars and package manager detection, must call `confirm_event_plan` before writing `track()` calls.
- **Detection order matters.** The `Integration` enum order in `constants.ts` controls both auto-detection priority (first match wins) and display order in the CLI select menu.

## Development commands

```bash
pnpm try           # run the wizard locally (from source, no build needed)
pnpm try --tui-v2  # run with the v2 TUI (parallel pipeline, new UX)
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
pnpm proxy         # start the Langley wizard LLM proxy (requires aws-vault)
pnpm dev           # build once, link globally, then watch + proxy in parallel
pnpm skills:refresh # refresh bundled integration/instrumentation skills
```

### Local LLM proxy

The wizard routes Claude API calls through a Langley proxy service instead of
hitting Anthropic directly. For local development, start the proxy before running
the wizard:

```bash
# Terminal 1 — start the proxy (in amplitude/wizard repo)
pnpm proxy

# Terminal 2 — run the wizard
WIZARD_PROXY_DEV_TOKEN=dev-token pnpm try
```

Or use `pnpm dev` to run both in one terminal.

`pnpm proxy` expects the `amplitude/javascript` repo to be a sibling directory
(`../javascript`). Override with `JS_REPO=/path/to/javascript pnpm proxy`.

It requires `aws-sso` with the `us-prod-dev` profile for credentials.
The proxy runs with `WIZARD_PROXY_DEV_BYPASS=1` which skips Amplitude OAuth — any
token value works locally (e.g. `WIZARD_PROXY_DEV_TOKEN=dev-token`).

## Testing

- **Unit tests:** `src/**/__tests__/` — vitest, run with `pnpm test`
- **Router + flow tests:** `src/ui/tui/__tests__/router.test.ts` — parameterized router resolution tests. `src/ui/tui/__tests__/flow-invariants.test.ts` — fast-check property-based tests verifying flow invariants (24 tests: no backward navigation, unauthenticated users never see Run, error state skips post-success screens, etc.)
- **BDD tests:** `features/*.feature` + `features/step-definitions/` — Cucumber.js, run with `pnpm test:bdd`
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
- `wizard-ci-trigger.yml` — downstream CI triggers

## Key docs

- [`docs/flows.md`](./docs/flows.md) — flow diagrams (source of truth for UX)
- [`docs/mcp-installation.md`](./docs/mcp-installation.md) — how MCP server installation works across editors
- [`docs/llm-proxy.md`](./docs/llm-proxy.md) — LLM proxy architecture and configuration
- [`docs/tui-v1-to-v2-migration.md`](./docs/tui-v1-to-v2-migration.md) — migration plan for making v2 the default TUI and removing v1
- [`docs/tui-v2-dual-mode-architecture.md`](./docs/tui-v2-dual-mode-architecture.md) — TUI + agent + CI mode architecture
- [`docs/tui-v2-critical-files.md`](./docs/tui-v2-critical-files.md) — files ranked by blast radius
- [`docs/tui-v2-engineering-patterns.md`](./docs/tui-v2-engineering-patterns.md) — async safety, retry, error classification patterns
- [`docs/tui-v2-reliability-improvements.md`](./docs/tui-v2-reliability-improvements.md) — reliability improvement plan and status
- [`docs/tui-v2-error-prone-code.md`](./docs/tui-v2-error-prone-code.md) — known race conditions and edge cases
