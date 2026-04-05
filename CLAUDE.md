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

- `bin.ts` — CLI entry point, yargs command definitions, mode flags (Node >=18.17.0 required)
- `src/run.ts` — main wizard orchestration, ties TUI to session

### TUI layer (`src/ui/tui/`)

Built with [Ink](https://github.com/vadimdemedes/ink) (React for CLIs) + nanostores for reactive state.

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

### Framework integrations (`src/frameworks/`)

Each framework has its own directory containing a `*-wizard-agent.ts` file that exports a `FrameworkConfig`. Detection order is defined by the `Integration` enum in `constants.ts`.

**Supported frameworks:** Next.js, Vue, React Router, Django, Flask, FastAPI, Swift, React Native, Android, Flutter, Go, Java, Unreal, Unity, Python (fallback), JavaScript/Node (fallback), JavaScript/Web (fallback), Generic (ultimate fallback)

Adding a new framework? Use the `adding-framework-support` skill (`.claude/skills/adding-framework-support/SKILL.md`).

### Skills (`skills/`)

Skills are bundled markdown-based instructions that the agent can follow during runs.

- `skills/integration/` — Per-framework SDK integration guides (step-by-step workflows with reference docs)
- `skills/instrumentation/` — Analytics instrumentation skills (event discovery, pattern matching, diff intake)

Skills are refreshed via `pnpm skills:refresh`.

### Steps (`src/steps/`)

Post-agent discrete steps: MCP server installation into editors, env var upload, prettier formatting.

### Utilities (`src/utils/`)

OAuth flow, analytics tracking, env var handling, API key storage, debug logging, URL construction, package manager detection, shell completions, Anthropic status checks, custom headers.

## Key conventions

- **Screens are passive.** Screens observe session state and render accordingly. They do not own navigation logic — the router derives the active screen from session state.
- **Session is the single source of truth.** All state lives in `WizardSession`. Screens and steps read from and write to the session; they do not communicate directly.
- **Flows are declarative.** Each flow is a pipeline of `{ screen, show, isComplete }` entries. Navigation advances automatically when `isComplete` returns true.
- **Overlays interrupt without breaking flow.** `OutageScreen` and `SettingsOverrideScreen` are pushed onto an overlay stack and popped when resolved, resuming the flow where it left off. Overlay enum: `Outage`, `SettingsOverride`, `Snake`, `Mcp`, `Slack`, `Logout`, `Login`.
- **Slash commands are always available.** `/org`, `/project`, `/region`, `/login`, `/logout`, `/whoami`, `/chart`, `/dashboard`, `/taxonomy`, `/slack`, `/help` must be interceptable at any point in the session.
- **Framework configs are data-driven.** No switch statements or per-framework routing. Everything goes through `FrameworkConfig` + `FRAMEWORK_REGISTRY`. The universal runner handles all shared behavior.
- **Agent commandments** (`src/lib/commandments.ts`) are always injected as system prompt. Key rules: never hardcode secrets, always use `wizard-tools` MCP for env vars and package manager detection, must call `confirm_event_plan` before writing `track()` calls.
- **Detection order matters.** The `Integration` enum order in `constants.ts` controls both auto-detection priority (first match wins) and display order in the CLI select menu.

## Development commands

```bash
pnpm try           # run the wizard locally (from source, no build needed)
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
