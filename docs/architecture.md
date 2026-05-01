# Amplitude Wizard CLI — Architecture

> `npx @amplitude/wizard` — an AI-powered CLI that instruments apps with Amplitude analytics.

The wizard authenticates the user, detects their framework, runs a Claude-powered
agent to install the SDK and instrument events, then guides them through first
chart, first dashboard, and Slack integration.

---

## Table of contents

- [The binary](#the-binary)
- [Three operating modes: TUI, CI, and Agent](#three-operating-modes-tui-ci-and-agent)
- [System diagram](#system-diagram)
- [External dependencies](#external-dependencies-non-npm)
- [Wizard flow (end-to-end)](#wizard-flow-end-to-end)
- [Architectural layers](#architectural-layers)
- [State management](#state-management)
- [How the agent works](#how-the-agent-works)
- [Session persistence](#session-persistence)
- [Authentication flow](#authentication-flow)
- [The WizardUI interface](#the-wizardui-interface)
- [TUI mode deep dive](#tui-mode-deep-dive)
- [CI mode deep dive](#ci-mode-deep-dive)
- [Screens reference](#screens-reference)
- [Framework system](#framework-system)
- [Skills system](#skills-system)
- [Post-agent steps](#post-agent-steps)
- [Middleware and benchmarking](#middleware-and-benchmarking)
- [Health checks](#health-checks)
- [Utilities reference](#utilities-reference)
- [Testing](#testing)
- [CI/CD](#cicd)
- [Key constants](#key-constants)
- [Directory map](#directory-map)

---

## The binary

```
package.json → "bin": { "amplitude-wizard": "dist/bin.js" }
```

`bin.ts` is the entry point. It uses yargs to define the CLI surface below:

| Command | What it does |
|---------|-------------|
| _(default)_ | Run the wizard (interactive TUI or `--ci` mode) |
| `login` | OAuth PKCE flow → store token in `~/.ampli.json` |
| `logout` | Clear stored credentials |
| `whoami` | Show current user, org, project, region |
| `feedback` | Submit product feedback |
| `slack` | Connect Amplitude project to Slack (launches TUI SlackSetup flow) |
| `region` | Switch data-center region (launches TUI RegionSelect flow) |
| `detect` | Detect the framework in the current project |
| `status` | Show project setup state: framework, SDK, API key, auth |
| `auth status` / `auth token` | Inspect the stored auth session or print the OAuth access token |
| `mcp add` / `mcp remove` / `mcp serve` | Manage the Amplitude MCP server |
| `manifest` | Print a machine-readable CLI description for AI agents |

### Global CLI flags

| Flag | Default | Description |
|------|---------|-------------|
| `--debug` | `false` | Enable verbose logging |
| `--verbose` | `false` | Print diagnostic info to the log |
| `--default` | `true` | Use default options for all prompts |
| `--signup` | `false` | Create a new Amplitude account |
| `--local-mcp` | `false` | Use local MCP server at localhost:8787 |
| `--ci` | `false` | CI mode — non-interactive, auto-approve |
| `--api-key` | — | Amplitude API key (bypasses OAuth) |
| `--project-id` | — | Amplitude project ID |

### Default command flags

| Flag | Default | Description |
|------|---------|-------------|
| `--force-install` | `false` | Force install despite peer dep failures |
| `--install-dir` | `process.cwd()` | Target directory (required for CI/agent) |
| `--integration` | — | Framework override (e.g., `nextjs`, `django`) |
| `--menu` | `false` | Show manual framework picker |
| `--benchmark` | `false` | Enable per-phase token tracking |
| `--agent` | `false` | Agent mode — structured NDJSON output, auto-approve |
| `--yes` / `-y` | `false` | Skip all prompts, same as `--ci` |

All flags support env var override via `AMPLITUDE_WIZARD_` prefix (e.g., `AMPLITUDE_WIZARD_CI=true`).

### Exit codes

| Code | Constant | Meaning |
|------|----------|---------|
| 0 | `SUCCESS` | Wizard completed successfully |
| 1 | `GENERAL_ERROR` | Unclassified error |
| 2 | `INVALID_ARGS` | Missing or invalid CLI arguments |
| 3 | `AUTH_REQUIRED` | Authentication failed or required |
| 4 | `NETWORK_ERROR` | Network connectivity issue |
| 10 | `AGENT_FAILED` | Agent run failed |
| 130 | `USER_CANCELLED` | User cancelled the wizard |

Defined in `src/lib/exit-codes.ts`.

---

## Three operating modes: TUI, CI, and Agent

The wizard has three execution modes that share the same business logic but
differ in user interaction.

### Mode selection (bin.ts)

```
--agent flag?
  ├─ YES → AgentUI (NDJSON output)
  │         Requires --install-dir
  │         Auto-approves all prompts
  │
  └─ NO
      ├─ --ci or --yes flag?
      │   ├─ YES → LoggingUI (CI mode)
      │   │         Requires --install-dir
      │   │
      │   └─ NO
      │       ├─ process.stdin.isTTY? → YES → InkUI (TUI mode)
      │       │                                Launch Ink React app
      │       │
      │       └─ NO → Error: "requires interactive terminal"
      │                Suggests --ci flag
```

### What is shared (all modes use these)

| Layer | Files | Description |
|-------|-------|-------------|
| **UI contract** | `src/ui/wizard-ui.ts` | `WizardUI` interface — 28 methods both modes implement |
| **UI singleton** | `src/ui/index.ts` | `getUI()` / `setUI()` — runtime polymorphism |
| **Session** | `src/lib/wizard-session.ts` | `WizardSession` — all state, same structure in both modes |
| **Agent runner** | `src/lib/agent-runner.ts` | `runAgentWizard()` — same orchestration |
| **Agent interface** | `src/lib/agent-interface.ts` | Same Claude Agent SDK integration |
| **Agent hooks** | `src/lib/agent-hooks.ts` | Same lifecycle callbacks |
| **Commandments** | `src/lib/commandments.ts` | Same system prompt rules |
| **Wizard tools** | `src/lib/wizard-tools.ts` | Same in-process MCP server |
| **Framework configs** | `src/frameworks/` | Same detection, prompts, env vars |
| **Skills** | `skills/` | Same bundled skill files |
| **Steps** | `src/steps/` | Same post-agent operations |
| **Utilities** | `src/utils/` | OAuth, analytics, API calls, etc. |
| **Run orchestration** | `src/run.ts` | `runWizard()` — same entry, builds session, calls agent runner |

The key insight: **all business logic calls `getUI()`**, never the TUI or logging
implementation directly. This means the agent runner, wizard tools, framework
detection, and post-agent steps are completely mode-agnostic.

### What is NOT shared

| Aspect | TUI mode (InkUI) | CI mode (LoggingUI) | Agent mode (AgentUI) |
|--------|-------------------|---------------------|----------------------|
| **Rendering** | Ink (React for terminals) with full-screen layout, tabs, colors | Simple `console.log` with Unicode markers (`┌ │ ✔ ▲ ✖`) | NDJSON — one JSON object per line to stdout |
| **State management** | `WizardStore` with nanostores — reactive atoms, subscriptions, re-renders | No reactive state; session mutations are no-ops | No reactive state; emits status/progress/result events |
| **Screen routing** | `WizardRouter` walks declarative flow pipelines | No screens, no routing, no transitions | No screens, no routing |
| **Overlays** | Stack-based interrupts (outage, snake game) | Warnings printed to console, then continue | Warnings emitted as JSON events |
| **Slash commands** | `/region`, `/login`, `/logout`, `/whoami`, `/mcp`, `/slack`, `/feedback`, `/snake`, `/exit` — always available | None | None |
| **Prompts** | Block the agent — user must respond (confirm, choose, approve event plan) | Auto-resolve: `promptConfirm` → `false`, `promptChoice` → `""`, `promptEventPlan` → `approved` | Auto-resolve: `promptConfirm` → `true`, `promptChoice` → first option, `promptEventPlan` → `approved` |
| **Error retry** | User presses R to retry; `setRunError()` blocks until user decides | `setRunError()` returns `false` immediately (no retry) | `setRunError()` emits error event, returns `false` (no retry) |
| **Heartbeat** | No-op (TUI shows live updates reactively) | Prints last N status messages every ~10 seconds | No-op (events stream continuously) |
| **Task progress** | `ProgressList` component with status icons, animated transitions | Logs `[completed/total] current task` | Emits `progress` JSON events |
| **Event plan** | Dedicated "Event plan" tab in RunScreen | Printed to console, auto-approved | Emitted as `result` JSON event, auto-approved |
| **Startup** | Concurrent: OAuth (browser popup) + framework detection + feature discovery, with TUI screens showing progress | Sequential: detect framework → run agent. Auth via `--api-key` flag or stored token | Sequential, same as CI. Auth via `--api-key` |
| **Tabs** | RunScreen has 5 tabs: Status, Event plan, All logs, Small Web, Snake | N/A | N/A |

### Prompt behavior — the critical difference

The `WizardUI` interface has three prompt methods that fundamentally differ between modes:

```typescript
// wizard-ui.ts
promptConfirm(message: string): Promise<boolean>;
promptChoice(message: string, options: string[]): Promise<string>;
promptEventPlan(events: Array<{name, description}>): Promise<EventPlanDecision>;
```

**TUI mode**: These return Promises that block the agent until the user interacts.
The store creates a `pendingPrompt` atom, the `ConsoleView` component renders the
prompt UI, and the Promise resolves when the user responds.

**CI mode**: These resolve immediately with defaults:
- `promptConfirm` → `false` (skip)
- `promptChoice` → `""` (skip)
- `promptEventPlan` → `{ decision: 'approved' }` (auto-approve all events)

This means in CI mode, the agent never pauses for user input — instrumentation
plans are auto-approved and confirmations auto-skipped.

---

## System diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                          User's terminal                              │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  amplitude-wizard  (Ink TUI — React for CLIs)                   │  │
│  │                                                                  │  │
│  │  ┌────────────┐  ┌──────────────┐  ┌─────────────────────────┐  │  │
│  │  │ WizardStore │←→│ WizardRouter │←→│ Screens (16 screens)    │  │  │
│  │  │ (nanostores)│  │ (flow cursor │  │ Intro · Auth · Region   │  │  │
│  │  │             │  │  + overlays) │  │ Setup · Run · MCP       │  │  │
│  │  └──────┬──────┘  └──────────────┘  │ DataIngestion · Check-  │  │  │
│  │         │                           │ list · Slack · Outro    │  │  │
│  │         │                           │ + 7 overlays            │  │  │
│  │         ▼                           └─────────────────────────┘  │  │
│  │  ┌──────────────┐                                                │  │
│  │  │WizardSession │  ◄── single source of truth for all state      │  │
│  │  └──────┬───────┘                                                │  │
│  │         │                                                        │  │
│  └─────────┼────────────────────────────────────────────────────────┘  │
│            │                                                          │
│            ▼                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  Agent Runner  (src/lib/agent-runner.ts)                        │  │
│  │                                                                  │  │
│  │  1. Resolve FrameworkConfig from FRAMEWORK_REGISTRY              │  │
│  │  2. Build system prompt (framework prompt + commandments)        │  │
│  │  3. Attach wizard-tools MCP server (in-process)                  │  │
│  │  4. Spawn Claude Agent SDK subprocess                            │  │
│  │     └─ claude CLI with ANTHROPIC_BASE_URL + auth token           │  │
│  └──────────────────────────┬──────────────────────────────────────┘  │
│                             │                                         │
└─────────────────────────────┼─────────────────────────────────────────┘
                              │
                              │  HTTPS (Messages API)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Amplitude LLM Gateway                                              │
│                                                                     │
│  Validates OAuth token → routes to Claude                           │
│  Endpoints: /health, /v1/models, /v1/messages                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## External dependencies (non-npm)

These are **services and sibling repos** the wizard depends on at runtime or
development time — not npm packages. For the full inventory with URLs, auth details,
and file system touchpoints, see [`external-services.md`](./external-services.md).

### Runtime services

| Dependency | Role | How the wizard talks to it |
|-----------|------|---------------------------|
| **Amplitude OAuth** (`core.amplitude.com/oauth2`) | User authentication (PKCE flow) | Local HTTP server on port 13222 receives callback; token stored in `~/.ampli.json` |
| **Amplitude LLM Gateway** | Routes Claude API calls so users never need an Anthropic key | `ANTHROPIC_BASE_URL` env var → Claude Agent SDK sends requests here |
| **Amplitude API** (`core.amplitude.com/api`) | Org/project listing, activation checks, API key validation | REST calls from AuthScreen and DataSetupScreen |
| **Amplitude MCP Server** (`mcp.amplitude.com/mcp`) | Gives Claude (in the user's editor) access to Amplitude tools | Wizard writes the server URL into editor configs; editors handle OAuth themselves |
| **Amplitude Experiment** | Feature flag evaluation (LLM analytics, agent analytics flags) | Local evaluation via `@amplitude/experiment-node-server` |
| **GitHub Releases** (`github.com/amplitude/wizard`) | Hosts downloadable skill bundles for the agent | `wizard-tools.ts` fetches skill menu and downloads skills on demand |

### Development-time dependencies

| Dependency | Role |
|-----------|------|
| **~/.ampli.json** | Shared credential store with the `ampli` CLI |

---

## Wizard flow (end-to-end)

This is the main user journey for the default command. Each box is a **screen**
in the TUI. Slash commands (`/region`, `/login`, `/logout`, `/whoami`, `/mcp`,
`/slack`, `/feedback`, `/help`) are available at any point.

```
IntroScreen                   Shows detected framework, user confirms
     │
     ▼
RegionSelectScreen            US or EU (skipped for returning users)
     │
     ▼
AuthScreen (SUSI flow)        OAuth → org picker → project picker → API key
     │
     ▼
DataSetupScreen               Checks activation level via API:
     │                          none    → proceed to Setup/Run
     │                          partial → show ActivationOptionsScreen
     │                          full    → skip to MCP
     ▼
SetupScreen                   Framework-specific disambiguation questions
     │                        (e.g. "Pages Router or App Router?")
     ▼
RunScreen                     Claude agent executes:
     │                          1. Install SDK + init code
     │                          2. Discover events + confirm plan
     │                          3. Instrument track() calls
     │                          4. Upload env vars to hosting
     ▼
McpScreen                     Install Amplitude MCP server into editors
     │                        (VS Code, Cursor, Zed, Claude Desktop,
     │                         Claude Code, Codex)
     ▼
DataIngestionCheckScreen      Polls activation API every 30s until events arrive
     │
     ▼
ChecklistScreen               First chart → first dashboard (unlocks after chart)
     │
     ▼
SlackScreen                   Connect Amplitude to Slack (optional)
     │
     ▼
OutroScreen                   Success / error / cancel + next steps
```

**Overlays** can interrupt any screen without breaking flow:
- `Outage` — Claude API unavailable
- `SettingsOverride` — `.claude/settings.json` has blocking keys
- `Snake` — snake game (easter egg)
- `Mcp` — MCP overlay (slash command)
- `Slack` — Slack overlay (slash command)
- `Logout` — logout confirmation
- `Login` — token refresh

### CI mode flow

In CI mode, there are no screens. The flow is linear:

```
bin.ts (--ci)
  → setUI(LoggingUI)
  → Validate --install-dir is provided
  → runWizard(args)
    → detectAndResolveIntegration()
      → Scan for framework (Integration enum order)
      → If not found: fall back to generic
    → runAgentWizard(config, session)
      → All prompts auto-approved
      → Status printed to console
    → Exit
```

---

## Architectural layers

### 1. CLI layer (`bin.ts`, `src/run.ts`)

Parses arguments, initializes services, builds `WizardSession`, and hands off to
the TUI or CI runner. Owns the boundary between "CLI tool" and "wizard logic."

**bin.ts responsibilities (TUI mode):**
1. Check the supported Node.js range
2. Remove legacy shell-completion lines from the user's shell rc
3. Import and call `startTUI()` — creates store, renders Ink app, swaps in InkUI
4. Build session from CLI args via `buildSession()`
5. Pre-populate credentials from `~/.ampli.json` for returning users (skips auth)
6. Initialize feature flags (non-blocking)
7. Kick off concurrent: OAuth task + framework detection task
8. Wait for user to reach RunScreen (`store.onEnterScreen(Screen.Run)`)
9. Check for pre-existing Amplitude installation → skip agent or run
10. Call `runWizard(args, session)` → `runAgentWizard()`

**bin.ts responsibilities (CI mode):**
1. Check the supported Node.js range
2. `setUI(new LoggingUI())`
3. Validate `--install-dir` is set (required in CI)
4. Call `runWizard(args)` — builds session internally

**run.ts responsibilities:**
1. Merge CLI args with environment variables
2. Resolve install directory
3. Build session if not provided
4. Detect framework (CI mode does this here; TUI mode did it in bin.ts)
5. Call `runAgentWizard(config, session)` in a retry loop
6. On error: call `getUI().setRunError()` — TUI blocks for retry, CI returns false

### 2. TUI layer (`src/ui/tui/`)

Built with **Ink** (React for terminals) and **nanostores** for reactive state.

| Component | Purpose |
|-----------|---------|
| `start-tui.ts` | Entry point: creates store, renders Ink app, swaps in InkUI, forces dark terminal background |
| `App.tsx` | Root Ink component — subscribes to store, resolves active screen via router, renders it |
| `WizardRouter` (`router.ts`) | Walks a declarative flow pipeline to resolve the active screen. Maintains an overlay stack for interruptions |
| `flows.ts` | Declares 5 flow pipelines (Wizard, McpAdd, McpRemove, SlackSetup, RegionSelect) as arrays of `{ screen, show, isComplete }` entries |
| `WizardStore` (`store.ts`) | Nanostore atoms wrapping `WizardSession` — reactive setters trigger re-renders |
| `screen-registry.tsx` | Maps `Screen` and `Overlay` enum values to React components |
| `console-commands.ts` | Slash command definitions and dispatch |
| `screens/` | 16 screen components, one file each |
| `components/` | Shared UI components (ConsoleView, TitleBar, AmplitudeLogo) |
| `primitives/` | Low-level building blocks (PickerMenu, ProgressList, TabContainer, LogViewer, etc.) |
| `services/` | TUI-specific services (mcp-installer) |

**Key rule**: Screens are passive. They read from the store and call store setters.
The router derives the active screen from session state — screens never navigate
directly.

### 3. Agent layer (`src/lib/`)

| Component | Purpose |
|-----------|---------|
| `agent-runner.ts` | Orchestrates the full agent run: version check → status check → TS detection → build prompt → spawn agent → handle post-run |
| `agent-interface.ts` | Lazy-loads `@anthropic-ai/claude-agent-sdk`, resolves the `claude` CLI binary, defines `AgentSignals`, manages permissions, streaming, stall detection |
| `commandments.ts` | 9 system prompt rules always appended (10 in demo mode via `DEMO_MODE_WIZARD=1`): no hallucinated secrets, use wizard-tools MCP, read before write, call `confirm_event_plan` before instrumenting, use TodoWrite for progress |
| `wizard-tools.ts` | In-process MCP server: 8 tools (check_env_keys, set_env_values, detect_package_manager, confirm_event_plan, confirm, choose, load_skill_menu, install_skill) |
| `safe-tools.ts` | Allowlist of ~100 linting/formatting tools the agent sandbox permits |
| `agent-hooks.ts` | Lifecycle callbacks (stop hook with 3 phases: drain feature queue → collect remark → allow stop) |

### 4. Framework layer (`src/frameworks/`, `src/lib/framework-config.ts`, `src/lib/registry.ts`)

Every supported framework implements the `FrameworkConfig<TContext>` interface.
`FRAMEWORK_REGISTRY` maps each `Integration` enum value to its config. The
enum order in `constants.ts` controls detection priority (first match wins)
and display order in the `--menu` picker.

**18 frameworks supported:**

| Category | Frameworks |
|----------|-----------|
| Web | Next.js, Vue, React Router, JavaScript/Web |
| Mobile | React Native, Swift, Android, Flutter |
| Backend | Django, Flask, FastAPI, Go, Java, Python, JavaScript/Node |
| Game engines | Unreal, Unity |
| Fallback | Generic |

### 5. Steps layer (`src/steps/`)

Post-agent discrete operations:

- **MCP server installation** — detect editors, write config, handle 6 clients
- **Environment variable upload** — push `.env` values to hosting providers (Vercel)
- **Prettier** — format code the agent touched

### 6. Skills (`skills/`)

Bundled markdown instructions that the agent follows during runs:

| Directory | Content | Purpose |
|-----------|---------|---------|
| `skills/integration/` | Per-framework SDK setup guides (34 skills) | Step-by-step workflow files (1.0-begin, 1.1-edit, 1.2-revise, 1.3-conclude) |
| `skills/instrumentation/` | Event discovery and pattern matching (5 skills) | Analyze code → discover surfaces → produce tracking plan |
| `skills/taxonomy/` | Quickstart taxonomy agent (1 skill) | Event naming conventions, starter-kit scoping, business-outcome naming |

### 7. Utilities (`src/utils/`)

~27 files covering: OAuth flow, analytics tracking, API key persistence
(`~/.ampli.json` and system keychain), environment handling, package manager
detection, URL construction, debug logging, shell completions, and more.

---

## State management

### WizardSession (`src/lib/wizard-session.ts`)

The single source of truth for all wizard state. Every screen, step, and utility
reads from and writes to this object.

```
WizardSession
│
├─ CLI args
│   debug, verbose, forceInstall, installDir, ci, signup, localMcp,
│   apiKey, menu, benchmark, projectId
│
├─ Detection results
│   integration, frameworkContext, frameworkConfig, typescript,
│   detectedFrameworkLabel, detectionComplete, introConcluded
│
├─ OAuth / auth state
│   pendingOrgs, pendingAuthIdToken, pendingAuthAccessToken,
│   pendingAuthCloudRegion, selectedOrgId, selectedOrgName,
│   selectedProjectId, selectedProjectName, selectedEnvName,
│   apiKeyNotice
│
├─ Credentials (set when auth completes)
│   credentials: { accessToken, idToken?, projectApiKey, host, projectId }
│
├─ Region
│   region: null | 'us' | 'eu'
│   regionForced: boolean (true when /region slash command invoked)
│
├─ Run lifecycle
│   runPhase: Idle → Running → Completed | Error
│   loginUrl, setupConfirmed
│
├─ Activation / data state
│   projectHasData: null | true | false
│   activationLevel: null | 'none' | 'partial' | 'full'
│   activationOptionsComplete, snippetConfigured
│   amplitudePreDetected, amplitudePreDetectedChoicePending
│   dataIngestionConfirmed
│
├─ Feature discovery
│   discoveredFeatures: DiscoveredFeature[] ('stripe' | 'llm' | 'session_replay' | 'engagement')
│   llmOptIn: boolean
│   sessionReplayOptIn: boolean
│   engagementOptIn: boolean
│   additionalFeatureQueue: AdditionalFeature[] ('llm' | 'session_replay' | 'engagement')
│   additionalFeatureCurrent: AdditionalFeature | null
│   additionalFeatureCompleted: AdditionalFeature[]
│   optInFeaturesComplete: boolean
│
├─ Post-agent state
│   mcpComplete, mcpOutcome, mcpInstalledClients[]
│   slackComplete, slackOutcome
│   checklistChartComplete, checklistDashboardComplete, checklistComplete
│
├─ Service health
│   serviceStatus: { description, statusPageUrl } | null
│   settingsOverrideKeys: string[]
│
└─ Outro
    outroData: { kind: Success|Error|Cancel, message?, changes?, docsUrl?,
                 continueUrl?, promptLogin?, canRestart? }
```

**RunPhase enum:**
- `Idle` — gathering input (intro, setup screens)
- `Running` — agent is executing
- `Completed` — agent finished successfully
- `Error` — agent failed

**buildSession(args)**: Factory function that initializes all fields from CLI args
with sensible defaults. Used by both `bin.ts` (TUI) and `run.ts` (CI).

### WizardStore (`src/ui/tui/store.ts`) — TUI only

Wraps `WizardSession` in nanostore atoms for reactive rendering:

- `$session` — the session object
- `$statusMessages` — agent status log
- `$tasks` — TodoWrite task items
- `$eventPlan` — proposed events
- `$commandMode` — slash command state
- `$screenError` — error for retry banner
- `$pendingPrompt` — blocking prompt from agent
- `$version` — change counter for React sync

40+ typed setter methods that update atoms and call `emitChange()`.
React components subscribe via `useSyncExternalStore`.

---

## How the agent works

### Agent initialization (`agent-interface.ts`)

```
initializeAgent()
│
├─ Check .claude/settings.json for blocking overrides
│   (ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN)
│   → If found: show SettingsOverride overlay or warning
│
├─ Determine auth method (priority order):
│   1. Direct ANTHROPIC_API_KEY env var → bypass gateway entirely
│   2. Amplitude LLM gateway (default) → set ANTHROPIC_BASE_URL + auth token
│   3. Local claude CLI fallback → for development
│
├─ Ping gateway /health (8s timeout, fail-fast)
│
├─ Configure MCP servers:
│   ├─ amplitude-wizard (remote, if token present)
│   ├─ Additional framework-specific MCP servers
│   └─ wizard-tools (in-process) — env vars, package detection, skills, prompts
│
└─ Return AgentRunConfig { workingDirectory, mcpServers, model, flags }
```

### Agent execution (`agent-interface.ts` → `runAgent()`)

```
runAgent(config, prompt, options, spinner, runConfig, middleware?)
│
├─ Build system prompt: claude_code preset + wizard commandments
│
├─ Start streaming with Claude Agent SDK
│   ├─ Stall detection: 20s timeout per message, up to 2 retries
│   ├─ Permission hook: wizardCanUseTool() filters Bash commands
│   └─ Stop hook: 3-phase (drain features → collect remark → allow stop)
│
├─ Message event loop:
│   ├─ 'assistant' messages:
│   │   ├─ Extract [STATUS] lines → push to UI
│   │   ├─ Intercept TodoWrite tool_use → syncTodos() to UI
│   │   └─ Pass to middleware.onMessage()
│   │
│   ├─ 'result' messages:
│   │   ├─ Check is_error → extract error type
│   │   └─ Accumulate result text
│   │
│   └─ Heartbeat every 10s: print last 3 STATUS messages
│
├─ Error detection in output:
│   AUTH_ERROR, MCP_MISSING, RESOURCE_MISSING, RATE_LIMIT, API_ERROR
│
├─ Auth-retry short-circuit:
│   The Claude SDK retries 401s ~10× with exponential backoff (~3 min).
│   A 401 won't recover within a run, so after AUTH_RETRY_LIMIT (=2)
│   consecutive `api_retry` system messages with error_status 401 (or
│   matching auth-error patterns), runAgent calls
│   controller.abort('auth_failed') and returns AUTH_ERROR. The runner
│   shows a friendly outro pointing to /signup as a manual fallback.
│
└─ Return { error?: AgentErrorType, message?: string }
```

### Agent runner (`agent-runner.ts` → `runAgentWizard()`)

**Pre-agent:**
1. Version check: detected vs minimum → show manual setup guide if too old
2. Anthropic status check → show degraded notice
3. Claude settings override check → backup/remove blocking overrides
4. TypeScript detection
5. Framework version detection + package.json check
6. OAuth/credential establishment
7. Cloud region determination
8. Framework context gathering
9. Analytics tags
10. Prompt building (custom or MCP-skills default)

**Agent run:**
1. Evaluate all feature flags
2. Build wizard metadata
3. Determine MCP URL and skills URL
4. Initialize agent (getAgent)
5. Create benchmark middleware if enabled
6. Call runAgent() with full config
7. Handle errors (auth, MCP, rate limit, API)

**Post-agent:**
1. Build env vars from framework config
2. Optional hosting upload (Vercel)
3. Build outro data (success/error/cancel, changes list, docsUrl)
4. Set session.outroData → OutroScreen renders

### The 6-step integration prompt (`buildIntegrationPrompt()`)

The prompt sent to the agent for MCP-skills-based frameworks:

1. **STEP 1** — `load_skill_menu` from wizard-tools MCP → find matching integration skill
2. **STEP 2** — `install_skill` to download/extract the skill
3. **STEP 3** — Read the skill's `SKILL.md` for available references
4. **STEP 4** — Follow numbered workflow files (1.0-begin → 1.1-edit → 1.2-revise → 1.3-conclude)
5. **STEP 5** — Set up env vars via wizard-tools (`check_env_keys`, `set_env_values`)
6. **STEP 6** — Add event tracking:
   - Load taxonomy skill for naming conventions
   - Load instrumentation skill for event discovery
   - Follow instrumentation workflow
   - Call `confirm_event_plan` before writing any `track()` calls

### Wizard tools MCP server (`wizard-tools.ts`)

In-process MCP server — secrets never leave the machine.

| Tool | Purpose | Returns |
|------|---------|---------|
| `check_env_keys` | Check which env var keys exist in a .env file | `{ key: 'present'\|'missing' }` per key |
| `set_env_values` | Create/update env vars, ensure .gitignore | "Updated N key(s) in filePath" |
| `detect_package_manager` | Detect npm/yarn/pnpm/bun/pip/poetry/etc. | JSON with detected managers, install/run commands |
| `load_skill_menu` | List available skills by category | Formatted list of skill IDs and names |
| `install_skill` | Download and extract a skill to `.claude/skills/` | Install path confirmation |
| `confirm` | Yes/no prompt to user | "true" or "false" |
| `choose` | Multiple-choice prompt to user | Selected option or empty string |
| `confirm_event_plan` | Show instrumentation plan for approval | "approved", "skipped", or "feedback: ..." |

### Permission model (`wizardCanUseTool()`)

The agent sandbox restricts what tools the Claude agent can call:

**Allowed:**
- Read, Write, Edit (except `.env` files — must use wizard-tools)
- Glob, Grep
- Bash with restrictions:
  - Package manager commands (npm, pip, go, cargo, etc.)
  - Safe scripts (build, install, test, typecheck, lint, etc.)
  - Linting tools from `safe-tools.ts` allowlist
  - Single pipe to `tail`/`head` only
  - Stderr redirect `2>&1`
- ListMcpResourcesTool, Skill

**Blocked:**
- Direct `.env` file operations
- Dangerous shell operators (`;`, backticks, `$`, `(`, `)`)
- Any tool not in the allowlist

---

## Session persistence

The wizard remembers users across runs through four persistence layers, checked
in order during startup in `bin.ts`:

### 1. OAuth tokens (`~/.ampli.json`)

Stored by `src/utils/ampli-settings.ts`. Contains access token, refresh token,
ID token, user profile, and zone. On restart the wizard calls `tryRefreshToken()`
(`src/utils/token-refresh.ts`) to silently exchange an expired access token using
the refresh token (365-day window) before falling back to browser OAuth.

### 2. API key store (`src/utils/api-key-store.ts`)

The project API key is persisted per-project via:
- **macOS Keychain** — `security` CLI, keyed by SHA-1 hash of the project directory
- **Linux keyring** — `secret-tool` CLI (gnome-keyring / KWallet)
- **.env.local fallback** — written to the project directory, auto-added to `.gitignore`

### 3. Project config (`.ampli.json` in the project directory)

Zone, org, project, and environment selections written by the Amplitude CLI
toolchain. Read by `src/lib/ampli-config.ts`. Stored key is `ProjectId`;
legacy files with `WorkspaceId` are auto-migrated to `ProjectId` on read, and
`writeAmpliConfig` only emits the new key.

### 4. Crash-recovery checkpoint (`src/lib/session-checkpoint.ts`)

A sanitized session snapshot (no credentials or tokens) saved to
`~/.amplitude/wizard/runs/<sha256(installDir)>/checkpoint.json`. Per-project
under the cache root so two parallel wizard runs in different directories
can't clobber each other's checkpoint. On restart, if the checkpoint
matches the current project directory and is less than 24 hours old, the
wizard restores: region, org/project selection, framework detection
results, and intro state. This lets users resume where they left off
after a crash without re-doing setup. Checkpoints are deleted on
successful completion via `clearCheckpoint()`.

### 5. Wizard storage layout (`src/utils/storage-paths.ts`)

Single source of truth for every wizard-managed path. Two storage roots:

- **Per-user cache root: `~/.amplitude/wizard/`** (override with
  `AMPLITUDE_WIZARD_CACHE_DIR`)
  - `runs/<sha256(installDir)>/log.txt` — per-project debug log
  - `runs/<sha256(installDir)>/log.ndjson` — structured log mirror
  - `runs/<sha256(installDir)>/benchmark.json` — benchmark middleware output
  - `runs/<sha256(installDir)>/checkpoint.json` — crash-recovery snapshot
  - `plans/<planId>.json` — plan/apply artifacts (24h TTL)
  - `state/<attemptId>.json` — agent recovery state for compactions
  - `update-check.json` — npm registry latest-version cache (24h TTL)
- **Per-project metadata dir: `<installDir>/.amplitude/`**
  - `events.json` — approved event plan (preserved across runs)
  - `dashboard.json` — URL of the dashboard the agent created

Both are gitignored (the project meta dir as a single `.amplitude/`
line). The agent contract is unchanged: `confirm_event_plan` is the
canonical writer for `events.json`. A legacy mirror at
`<installDir>/.amplitude-events.json` is also written for backwards
compatibility with bundled integration skills; both the canonical and
legacy paths are gitignored and preserved across runs (the legacy
mirror is dropped once context-hub ships a skill set that reads the
canonical path). The `/diagnostics` slash command prints the full
layout for the current project — useful when filing bug reports.

---

## Authentication flow

```
User runs wizard
     │
     ├─ Check ~/.ampli.json for existing token
     │   ├─ Valid token + stored API key → skip OAuth, auto-detect region
     │   ├─ Valid token + single environment → auto-select API key
     │   ├─ Valid token + multiple environments → defer to AuthScreen picker
     │   └─ Missing/expired → start OAuth
     │
     ▼
OAuth PKCE flow
     │
     ├─ Wait for region selection (US/EU determines OAuth endpoint)
     ├─ Open browser → core.amplitude.com/oauth2/authorize
     ├─ Local HTTP server on port 13222 receives callback
     ├─ Exchange code for token
     ├─ Store token + user info in ~/.ampli.json
     └─ Auto-detect region from token claims
           │
           ▼
     Org picker (if multiple) → Project picker (if multiple) → API key
```

**CI mode auth:** Pass `--api-key <key>` on the command line. The wizard uses this
directly without OAuth. If no key is provided, it checks `~/.ampli.json` for stored
credentials.

---

## The WizardUI interface

`src/ui/wizard-ui.ts` defines the contract both modes implement. Here's every
method with its behavior in each mode:

### Lifecycle

| Method | TUI (InkUI) | CI (LoggingUI) |
|--------|-------------|----------------|
| `intro(msg)` | Push to status messages | `console.log("┌ msg")` |
| `outro(msg)` | Set OutroData, advance RunPhase to Completed | `console.log("└ msg")` |
| `cancel(msg, opts?)` | Set OutroData with Cancel kind, advance RunPhase to Error | `console.log("■ msg")` + docs URL |

### Logging

| Method | TUI | CI |
|--------|-----|-----|
| `log.info(msg)` | Push to status messages | `console.log("│ msg")` |
| `log.warn(msg)` | Push to status messages | `console.log("▲ msg")` |
| `log.error(msg)` | Push to status messages | `console.log("✖ msg")` |
| `log.success(msg)` | Push to status messages | `console.log("✔ msg")` |
| `log.step(msg)` | Push to status messages | `console.log("◇ msg")` |
| `note(msg)` | Push to status messages | `console.log("│ msg")` |
| `pushStatus(msg)` | Push to status messages | `console.log("◇ msg")` |
| `heartbeat(statuses)` | **No-op** (TUI shows live updates) | Print statuses to stdout |

### Spinner

| Method | TUI | CI |
|--------|-----|-----|
| `spinner().start(msg)` | Push to status | Write to stdout (no newline) |
| `spinner().stop(msg)` | Push to status | Overwrite spinner line with `●` |
| `spinner().message(msg)` | Push to status | Overwrite spinner line |

### Session state

| Method | TUI | CI |
|--------|-----|-----|
| `startRun()` | Set RunPhase to Running | No-op |
| `setRunError(error)` | Show error banner, **block until user presses R** → return `true` | Return `false` immediately (no retry) |
| `setCredentials(creds)` | Update store → router advances past Auth | No-op |
| `showServiceStatus(data)` | Push Outage overlay | Print warning to console |
| `showSettingsOverride(keys, fix)` | **Block until user chooses** (backup or exit) | Print warning, resolve immediately |
| `setDetectedFramework(label)` | Update store | `console.log("✔ Framework: label")` |
| `onEnterScreen(screen, fn)` | Register callback in store | No-op |
| `setLoginUrl(url)` | Update store | Print URL to console |
| `setRegion(region)` | Update store → router advances past RegionSelect | No-op |
| `setProjectHasData(value)` | Update store → router advances past DataSetup | No-op |

### Prompts

| Method | TUI | CI |
|--------|-----|-----|
| `promptConfirm(msg)` | **Block agent** until user responds Y/N | Return `false` (auto-skip) |
| `promptChoice(msg, opts)` | **Block agent** until user selects | Return `""` (auto-skip) |
| `promptEventPlan(events)` | **Block agent** — user can approve, skip, or give feedback | Return `{ decision: 'approved' }` (auto-approve) |

### State sync

| Method | TUI | CI |
|--------|-----|-----|
| `syncTodos(todos)` | Update $tasks atom → ProgressList re-renders | Log `[completed/total] current task` |
| `setEventPlan(events)` | Update $eventPlan atom → EventPlanViewer shows | No-op |

---

## TUI mode deep dive

### Startup sequence (`bin.ts` TUI branch)

```
1. startTUI(version)
   ├─ Force dark terminal background (OSC escape sequences)
   ├─ Create WizardStore(Flow.Wizard)
   ├─ Create InkUI(store) → setUI(inkUI)
   └─ render(App, { store }) via Ink

2. Build session from CLI args → store.session = session

3. Pre-populate credentials from ~/.ampli.json
   ├─ Check stored user + zone
   ├─ Check stored API key
   ├─ If single environment → auto-select
   ├─ If multiple → defer to AuthScreen picker
   └─ Pre-populate org/project from ampli.json

4. Initialize feature flags (non-blocking)

5. Concurrent tasks (while user sees IntroScreen/AuthScreen):
   ├─ authTask: Wait for region → OAuth → fetchAmplitudeUser → store.setOAuthComplete()
   └─ detectionTask: detectAllFrameworks() → gatherContext() → feature discovery → store.setDetectionComplete()

6. await tui.waitForSetup()
   └─ Blocks until onEnterScreen(Screen.Run) fires completeSetup()

7. Check for pre-existing Amplitude → skip or run agent

8. await runWizard(args, session)
```

### Flow router (`router.ts`)

The router resolves the active screen by walking a declarative pipeline:

```typescript
resolve(session: WizardSession): ScreenName {
  // Overlays take priority
  if (this.overlays.length > 0) return top overlay;

  // Cancel jumps directly to Outro
  if (session.outroData?.kind === OutroKind.Cancel) return Screen.Outro;

  // Walk flow entries
  for (const entry of this.flow) {
    if (entry.show && !entry.show(session)) continue;  // skip hidden
    if (entry.isComplete && entry.isComplete(session)) continue;  // skip done
    return entry.screen;  // first incomplete screen
  }

  // All done — show last screen (outro)
  return this.flow[this.flow.length - 1].screen;
}
```

### Flow pipelines (`flows.ts`)

**Wizard flow** (main flow, 12 entries):

| # | Screen | Show condition | Complete condition |
|---|--------|---------------|-------------------|
| 1 | Intro | always | `introConcluded` |
| 2 | RegionSelect | `region === null \|\| regionForced` | `region !== null && !regionForced` |
| 3 | Auth | `runPhase !== Error` | `credentials !== null` |
| 4 | DataSetup | always | `projectHasData !== null` |
| 5 | ActivationOptions | `activationLevel === 'partial'` | `activationOptionsComplete` |
| 6 | Setup | `needsSetup() && activationLevel !== 'full'` | `!needsSetup()` |
| 7 | Run | `activationLevel !== 'full'` | `runPhase === Completed \|\| Error` |
| 8 | Mcp | `runPhase !== Error` | `mcpComplete` |
| 9 | DataIngestionCheck | `runPhase !== Error && activationLevel !== 'full'` | `dataIngestionConfirmed` |
| 10 | Checklist | `runPhase !== Error` | `checklistComplete` |
| 11 | Slack | `runPhase !== Error` | `slackComplete` |
| 12 | Outro | always | — |

**Other flows:** McpAdd (2 entries), McpRemove (2 entries), SlackSetup (2 entries), RegionSelect (1 entry).

### Slash commands (`console-commands.ts`)

Available at any time in TUI mode:

| Command | Action |
|---------|--------|
| `/region` | Push RegionSelect overlay |
| `/login` | Push Login overlay (token refresh) |
| `/logout` | Push Logout overlay (clear credentials) |
| `/whoami` | Display current user, org, project, region |
| `/mcp` | Push MCP overlay |
| `/slack` | Push Slack overlay |
| `/feedback <msg>` | Submit product feedback event |
| `/test` | Run agent health checks |
| `/snake` | Push Snake game overlay |
| `/exit` | Exit the wizard |

### ConsoleView component (`components/ConsoleView.tsx`)

The root container for all screens. Handles:
- Slash command input bar (activated with `/` or Tab)
- Free-text queries to Claude (conversation mode)
- Prompt rendering (confirm, choice, event plan)
- Screen error display
- Command feedback display

---

## CI mode deep dive

### What CI mode does differently

1. **No screens**: No router, no store, no Ink rendering. Just `console.log`.
2. **No interactive prompts**: All prompts auto-resolve with defaults.
3. **No concurrent startup**: Framework detection happens sequentially in `run.ts`.
4. **No retry on error**: `setRunError()` returns `false` → `wizardAbort()`.
5. **Requires `--install-dir`**: Must specify target directory explicitly.
6. **Heartbeat active**: Prints status summaries every ~10 seconds.

### CI mode usage

```bash
# Minimal
npx @amplitude/wizard --ci --install-dir .

# With API key (skips OAuth entirely)
npx @amplitude/wizard --ci --install-dir . --api-key <YOUR_KEY>

# With framework override
npx @amplitude/wizard --ci --install-dir . --integration nextjs

# With project ID
npx @amplitude/wizard --ci --install-dir . --api-key <KEY> --project-id 12345
```

### CI output format

```
┌  Welcome to the Amplitude setup wizard
│  Running in CI mode
✔  Framework: Next.js
◌  Writing your Amplitude setup...
│  [STATUS] Checking project structure
│  [STATUS] Verifying Amplitude dependencies
?  Instrumentation plan (auto-approved in CI):
│  - Page Viewed: User views a page
│  - Button Clicked: User clicks a CTA button
◌  [3/7] Implementing event tracking
●  Writing your Amplitude setup...
└  Done
```

---

## Screens reference

### Main flow screens

| Screen | File | Reads from session | Writes to session | Key behavior |
|--------|------|-------------------|-------------------|-------------|
| **IntroScreen** | `screens/IntroScreen.tsx` | `detectionComplete`, `frameworkConfig`, `detectedFrameworkLabel` | `introConcluded` (via `concludeIntro()`) | Shows detected framework, user confirms or picks manually. Three states: detecting (spinner), failed (auto-Generic), succeeded (menu) |
| **RegionSelectScreen** | `screens/RegionSelectScreen.tsx` | `region`, `regionForced` | `region` (via `setRegion()`) | US/EU picker. Skipped for returning users |
| **AuthScreen** | `screens/AuthScreen.tsx` | `pendingOrgs`, tokens, `selectedOrgId`, `selectedProjectId`, `credentials` | Org/project selection, `credentials`, `region` | Multi-step SUSI flow with org → project → environment pickers |
| **DataSetupScreen** | `screens/DataSetupScreen.tsx` | `projectHasData` | `activationLevel`, `snippetConfigured` | Checks activation via API. Routes: none→setup, partial→options, full→skip |
| **ActivationOptionsScreen** | `screens/ActivationOptionsScreen.tsx` | `snippetConfigured` | `outroData` | Help test locally, debug, docs, or exit |
| **SetupScreen** | `screens/SetupScreen.tsx` | Framework questions | `frameworkContext[key]` | Auto-detects answers, shows picker for unresolved questions |
| **FeatureOptInScreen** | `screens/FeatureOptInScreen.tsx` | `discoveredFeatures` | `additionalFeatureQueue`, `optInFeaturesComplete` | Multi-select picklist (all on by default) for opt-in features (LLM, Session Replay). Skipped in CI/agent (auto-confirmed) and when nothing was discovered |
| **RunScreen** | `screens/RunScreen.tsx` | `tasks`, `eventPlan`, `statusMessages`, `discoveredFeatures`, `additionalFeatureQueue`, `additionalFeatureCurrent`, `additionalFeatureCompleted` | `requestedTab` (clear) | Observational: 3–4 tabs (Status, Event plan (conditional), All logs, Snake). Shows ProgressList including queued additional features as task items |
| **McpScreen** | `screens/McpScreen.tsx` | `runPhase`, `amplitudePreDetected` | `mcpComplete`, `mcpOutcome`, `mcpInstalledClients` | Detect editors → confirm → pick → install. Also handles pre-detected choice |
| **DataIngestionCheckScreen** | `screens/DataIngestionCheckScreen.tsx` | `region`, org/project IDs | `dataIngestionConfirmed` | Polls activation API every 30s. Exit with q/Esc |
| **ChecklistScreen** | `screens/ChecklistScreen.tsx` | `checklistChartComplete`, `checklistDashboardComplete` | `checklistComplete` | First chart → first dashboard. Dashboard locked until chart done |
| **SlackScreen** | `screens/SlackScreen.tsx` | `selectedOrgName`, `selectedOrgId`, `region` | `slackComplete`, `slackOutcome` | 4 phases: prompt → opening → waiting → done |
| **OutroScreen** | `screens/OutroScreen.tsx` | `outroData` | — | Success: picker (view report, open dashboard, exit). Error/cancel: any key exits |

### Overlay screens

| Overlay | File | Purpose |
|---------|------|---------|
| **OutageScreen** | `screens/OutageScreen.tsx` | Claude API unavailable. Continue or exit |
| **SettingsOverrideScreen** | `screens/SettingsOverrideScreen.tsx` | Blocking .claude/settings.json keys. Backup or exit |
| **LoginScreen** | `screens/LoginScreen.tsx` | Silent token refresh. Auto-exits |
| **LogoutScreen** | `screens/LogoutScreen.tsx` | Clear credentials confirmation |
| **SnakeGame** | via `primitives/SnakeGame.tsx` | Easter egg |

---

## Framework system

### FrameworkConfig<TContext> interface

```typescript
interface FrameworkConfig<TContext> {
  metadata: {
    name: string;                          // "Next.js"
    integration: Integration;              // Integration.nextjs
    docsUrl: string;                       // SDK docs URL
    unsupportedVersionDocsUrl?: string;    // For old versions
    beta?: boolean;                        // Shows beta notice
    preRunNotice?: string;                 // Warning before agent (e.g., Xcode)
    gatherContext?(opts): Promise<TContext>; // Pre-agent context gathering
    additionalMcpServers?: McpServer[];    // Extra MCP servers
    setup?: { questions: SetupQuestion[] }; // Disambiguation questions
  };

  detection: {
    packageName: string;                   // "next"
    packageDisplayName: string;            // "Next.js"
    getVersion(pkg): string | undefined;   // Extract version from package.json
    getVersionBucket?(v): string;          // Normalize "15.x" for analytics
    usesPackageJson?: boolean;             // Default true; false for Python/Go
    minimumVersion?: string;               // Enforce version check
    getInstalledVersion?(): Promise<string>; // Runtime version check
    detect(opts): Promise<boolean>;        // Is this framework present?
    detectPackageManager: PackageManagerDetector;
  };

  environment: {
    uploadToHosting: boolean;              // Push to Vercel?
    getEnvVars(apiKey, host): Record<string, string>;
  };

  analytics: {
    getTags(context): Record<string, string>;
    getEventProperties?(context): Record<string, string>;
  };

  prompts: {
    buildPrompt?(context): string;         // Custom prompt (overrides default)
    getAdditionalContextLines?(context): string[];
    projectTypeDetection: string;          // How to detect project type
    packageInstallation?: string;          // Override install instructions
  };

  ui: {
    successMessage: string;
    estimatedDurationMinutes: number;
    getOutroChanges(context): string[];    // "What the agent did" bullets
    getOutroNextSteps(context): string[];  // "Next steps" bullets
  };
}
```

### Detection order

Defined by `Integration` enum in `constants.ts`. First match wins:

```
nextjs → vue → reactRouter → django → flask → fastapi → swift →
reactNative → android → flutter → go → java → unreal → unity →
javascript_web → python → javascriptNode → generic
```

### Adding a new framework

Use an existing framework directory and integration skill as your reference.
The process:
1. Add enum value to `Integration` in `constants.ts` (position matters)
2. Create `src/frameworks/<name>/<name>-wizard-agent.ts` exporting a `FrameworkConfig`
3. Register in `src/lib/registry.ts`
4. Add integration skill in `skills/integration/`
5. Add docs URL to `OUTBOUND_URLS.frameworkDocs` in `constants.ts`

---

## Skills system

Skills are bundled markdown instructions that the Claude agent follows during runs.
They provide structured, step-by-step workflows with reference documentation.

### Integration skills (`skills/integration/`)

Each skill has:
```
skills/integration/<skill-id>/
├── SKILL.md              # Entry point — lists available references
└── references/
    ├── basic-integration-1.0-begin.md     # Step 1: Analyze project, create event plan
    ├── basic-integration-1.1-edit.md      # Step 2: Implement tracking code
    ├── basic-integration-1.2-revise.md    # Step 3: Fix errors, run linter
    ├── basic-integration-1.3-conclude.md  # Step 4: Verify env vars, create dashboard, write report
    ├── EXAMPLE.md                         # Reference implementation
    ├── amplitude-quickstart.md            # SDK quickstart docs
    └── browser-sdk-2.md (etc.)            # SDK reference docs
```

### Instrumentation skills (`skills/instrumentation/`)

| Skill | Purpose |
|-------|---------|
| `add-analytics-instrumentation` | End-to-end orchestrator: intent → discovery → plan |
| `discover-event-surfaces` | Find instrumentable locations in code |
| `discover-analytics-patterns` | Identify existing tracking patterns |
| `instrument-events` | Write actual tracking code |
| `diff-intake` | Analyze PR/branch diffs for instrumentation |

### Taxonomy skill (`skills/taxonomy/`)

`amplitude-quickstart-taxonomy-agent` — enforces naming conventions:
- Business-outcome event naming
- Small property sets
- No redundant pageview events
- Funnel-friendly linkage

### Skill loading flow

```
Agent prompt says: "Call load_skill_menu"
  → wizard-tools MCP returns skill list
Agent says: "Call install_skill('integration-nextjs-app-router')"
  → wizard-tools copies from skills/ to .claude/skills/
Agent reads: .claude/skills/integration-nextjs-app-router/SKILL.md
  → Follows workflow files in sequence
```

---

## Post-agent steps

### MCP server installation (`src/steps/add-mcp-server-to-clients/`)

Installs the Amplitude MCP server into supported editors:

| Client | Config location | Format |
|--------|-----------------|--------|
| VS Code | `~/Library/Application Support/Code/User/mcp.json` | `servers` object |
| Zed | `~/.config/zed/settings.json` | `context_servers` object |
| Cursor | `~/.cursor/mcp.json` | `mcpServers` object |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` | `mcpServers` via SSE |
| Claude Code | CLI (`claude mcp add`) | streamable-http |
| Codex | CLI (`codex mcp add`) | streamable-http |

Server URLs: `https://mcp.amplitude.com/mcp` (US), `https://mcp.eu.amplitude.com/mcp` (EU).

### Environment variable upload (`src/steps/upload-environment-variables/`)

Pushes `.env` values to hosting providers. Currently supports Vercel.

### Prettier (`src/steps/run-prettier.ts`)

Formats files the agent created or modified.

---

## Middleware and benchmarking

The middleware system (`src/lib/middleware/`) provides pluggable observability for agent runs.

### Pipeline architecture

```typescript
interface Middleware {
  readonly name: string;
  onInit?(ctx): void;
  onMessage?(message, ctx, store): void;
  onPhaseTransition?(from, to, ctx, store): void;
  onFinalize?(result, durationMs, ctx, store): unknown;
}
```

### Benchmark trackers

When `--benchmark` is passed, these trackers are enabled:

| Tracker | What it measures |
|---------|-----------------|
| Token tracker | Input/output token counts per phase |
| Cache tracker | Cache read/creation token counts |
| Cost tracker | USD cost estimation |
| Duration tracker | Wall-clock time per phase |
| Turn counter | Number of agent turns |
| Compaction tracker | Context compaction events |
| Context size tracker | Context window usage |
| Summary | Human-readable summary |
| JSON writer | Machine-readable `.benchmark.json` output |

Output: `BenchmarkData` with per-step breakdowns and totals.

---

## Health checks

`src/lib/health-checks/` monitors external service health before and during runs.

### Services monitored

| Service | Source | Blocking? |
|---------|--------|-----------|
| Anthropic (Claude) | status.claude.com | Down or degraded blocks run |
| Amplitude | amplitudestatus.com | Down blocks run |
| npm | npmjs.org status | Down blocks run |
| GitHub | githubstatus.com | Not blocking |
| Cloudflare | cloudflarestatus.com | Not blocking |
| LLM Gateway | Direct endpoint ping | Down blocks run |
| MCP Server | Direct endpoint ping | Down blocks run |

### Readiness evaluation

```typescript
enum WizardReadiness { Yes, No, YesWithWarnings }
```

Default blocking config:
- **Down blocks run:** anthropic, amplitudeOverall, npmOverall, llmGateway, mcp
- **Degraded blocks run:** anthropic

---

## Utilities reference

| File | Purpose |
|------|---------|
| `oauth.ts` | OAuth PKCE flow: browser redirect, local HTTP server on port 13222, token exchange |
| `analytics.ts` | Amplitude telemetry: `resolveTelemetryApiKey()`, `sessionProperties()`, `captureWizardError()` |
| `ampli-settings.ts` | `~/.ampli.json` credential store: `readCredentials()`, `storeToken()`, `clearCredentials()` |
| `api-key-store.ts` | Per-project API key persistence (keychain / .env.local) |
| `token-refresh.ts` | Silent OAuth token refresh via refresh token (365-day window) |
| `atomic-write.ts` | Atomic JSON file writes (temp + rename) for crash safety |
| `api.ts` | Amplitude REST/GraphQL API calls: `fetchAmplitudeUser()` |
| `urls.ts` | URL builders: `getLlmGatewayUrlFromHost()`, `buildMCPUrl()`, `detectRegionFromToken()`, `getHostFromRegion()` |
| `debug.ts` | File logging: `logToFile()`, `enableDebugLogs()`, `getLogFilePath()` |
| `logging.ts` | CLI color output helpers |
| `environment.ts` | Read env vars: `readEnvironment()`, `isNonInteractiveEnvironment()` |
| `bash.ts` | Shell execution: `runCommand()`, `runCommandQuiet()` |
| `file-utils.ts` | File I/O helpers |
| `get-api-key.ts` | API key retrieval and validation |
| `package-json.ts` | `getPackageVersion()`, `hasPackageInstalled()` |
| `package-manager.ts` | `detectAllPackageManagers()` |
| `semver.ts` | `fulfillsVersionRange()` |
| `string.ts` | Case conversion, formatting |
| `anthropic-status.ts` | `checkAnthropicStatus()` |
| `custom-headers.ts` | `createCustomHeaders()` for telemetry |
| `track-wizard-feedback.ts` | Product feedback submission |
| `wizard-abort.ts` | Graceful shutdown: `wizardAbort()`, `WizardError` class |
| `setup-utils.ts` | `tryGetPackageJson()`, `isUsingTypeScript()`, `getOrAskForProjectData()`, `performAmplitudeAuth()` |

---

## Testing

### Unit tests (`pnpm test`)

Located in `src/**/__tests__/`. Run with vitest.

### BDD tests (`pnpm test:bdd`)

Located in `features/`. Run with Cucumber.js.
Gherkin scenarios test user-visible behavior.

### E2E tests (`pnpm test:e2e`)

Located in `e2e-tests/`. Build the wizard, run against test applications in
`e2e-tests/test-applications/`.

### Proxy tests (`pnpm test:proxy`)

Validate LLM proxy connectivity, model availability, streaming.

---

## CI/CD

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `build.yml` | Push / PR | Build, lint, unit tests (Node 20/22/24 matrix), Codecov |
| `behavior-driven-tests.yml` | Push / PR | Cucumber BDD tests |
| `pr-conventional-commit.yml` | PR | Validates PR title follows conventional commits |
| `publish.yml` | Release / manual | npm publish with OIDC provenance under `beta` dist-tag |
| `release-please.yml` | Push to main | Automated version bump, changelog, release PR |
| `refresh-integration-skills.yml` | Schedule | Auto-update integration skill bundles |
| `refresh-instrumentation-skills.yml` | Schedule | Auto-update instrumentation skill bundles |

### Release process

All releases are currently **beta prereleases** (`1.0.0-beta.N`) published under
the `beta` npm dist-tag. The automated flow:

```
PR merged to main (conventional commit)
  → release-please creates/updates a release PR (version bump + CHANGELOG)
  → Merge the release PR → GitHub Release + tag created
  → a maintainer approves the npm-publish environment
  → Published to npm with OIDC provenance
```

Security controls: OIDC trusted publishing (no static npm tokens), `--provenance`
supply-chain attestation, SHA-pinned actions, and CODEOWNERS requiring maintainer
review on workflow/manifest changes.

---

## Key constants

| Constant | Value | Defined in |
|----------|-------|-----------|
| npm package | `@amplitude/wizard` | `package.json` |
| Binary name | `amplitude-wizard` | `package.json` |
| OAuth callback port | `13222` | `src/lib/constants.ts` |
| LLM Gateway | Configured via `ANTHROPIC_BASE_URL` | `src/utils/urls.ts` |
| MCP server (US) | `https://mcp.amplitude.com/mcp` | `src/steps/.../defaults.ts` |
| MCP server (EU) | `https://mcp.eu.amplitude.com/mcp` | `src/steps/.../defaults.ts` |
| Node.js minimum | `>=20` | `bin.ts` |
| Credential store | `~/.ampli.json` | `src/utils/ampli-settings.ts` |
| Detection timeout | `10,000ms` | `src/lib/constants.ts` |
| Stall detection | `60,000ms` cold-start / `120,000ms` mid-run | `src/lib/agent-interface.ts` |

---

## Directory map

```
amplitude/wizard
├── bin.ts                          CLI entry point (yargs commands)
├── src/
│   ├── run.ts                      Main wizard orchestration
│   ├── lib/
│   │   ├── wizard-session.ts       Session state (single source of truth)
│   │   ├── agent-runner.ts         Agent orchestration (runAgentWizard)
│   │   ├── agent-interface.ts      Claude Agent SDK integration
│   │   ├── agent-hooks.ts          Agent lifecycle callbacks
│   │   ├── commandments.ts         Always-on system prompt rules (9 rules, 10 in demo mode)
│   │   ├── framework-config.ts     FrameworkConfig<T> interface
│   │   ├── registry.ts             FRAMEWORK_REGISTRY (18 frameworks)
│   │   ├── constants.ts            Integration enum, URLs, env flags
│   │   ├── wizard-tools.ts         In-process MCP server (8 tools)
│   │   ├── safe-tools.ts           Agent tool allowlist (~100 tools)
│   │   ├── exit-codes.ts           Structured exit codes (0-130)
│   │   ├── session-checkpoint.ts   Crash-recovery checkpoint (save/load/clear)
│   │   ├── feature-flags.ts        Amplitude Experiment flags
│   │   ├── detect-amplitude.ts     Pre-existing SDK detection
│   │   ├── api.ts                  Amplitude API client
│   │   ├── ampli-config.ts         .ampli.json project config
│   │   ├── package-manager-detection.ts  Cross-ecosystem PM detection
│   │   ├── middleware/             Benchmark pipeline (9 trackers)
│   │   └── health-checks/         Service status monitoring
│   ├── ui/
│   │   ├── index.ts                UI singleton (getUI/setUI)
│   │   ├── wizard-ui.ts            WizardUI interface (28 methods)
│   │   ├── logging-ui.ts           CI mode: console output, auto-approve
│   │   ├── agent-ui.ts             Agent mode: NDJSON output, auto-approve
│   │   └── tui/
│   │       ├── start-tui.ts        TUI bootstrap: store, InkUI, Ink render
│   │       ├── App.tsx             Root Ink component
│   │       ├── ink-ui.ts           TUI mode: delegates to WizardStore
│   │       ├── router.ts           Flow cursor + overlay stack
│   │       ├── flows.ts            5 flow pipelines (Screen/Flow enums)
│   │       ├── store.ts            Nanostore reactive state (40+ setters)
│   │       ├── screen-registry.tsx  Screen → component mapping
│   │       ├── console-commands.ts  Slash command definitions
│   │       ├── screens/            16 screen components
│   │       │   ├── IntroScreen.tsx
│   │       │   ├── RegionSelectScreen.tsx
│   │       │   ├── AuthScreen.tsx
│   │       │   ├── DataSetupScreen.tsx
│   │       │   ├── ActivationOptionsScreen.tsx
│   │       │   ├── SetupScreen.tsx
│   │       │   ├── RunScreen.tsx
│   │       │   ├── McpScreen.tsx
│   │       │   ├── DataIngestionCheckScreen.tsx
│   │       │   ├── ChecklistScreen.tsx
│   │       │   ├── SlackScreen.tsx
│   │       │   ├── OutroScreen.tsx
│   │       │   ├── OutageScreen.tsx
│   │       │   ├── SettingsOverrideScreen.tsx
│   │       │   ├── LoginScreen.tsx
│   │       │   └── LogoutScreen.tsx
│   │       ├── components/         Shared: ConsoleView, TitleBar, Logo
│   │       ├── primitives/         15+ primitives: PickerMenu, ProgressList,
│   │       │                       TabContainer, LogViewer, ReportViewer,
│   │       │                       EventPlanViewer, SnakeGame, etc.
│   │       └── services/           mcp-installer
│   ├── frameworks/                 18 framework integrations
│   │   ├── nextjs/
│   │   ├── vue/
│   │   ├── react-router/
│   │   ├── django/
│   │   ├── flask/
│   │   ├── fastapi/
│   │   ├── swift/
│   │   ├── react-native/
│   │   ├── android/
│   │   ├── flutter/
│   │   ├── go/
│   │   ├── java/
│   │   ├── unreal/
│   │   ├── unity/
│   │   ├── python/
│   │   ├── javascript-node/
│   │   ├── javascript-web/
│   │   └── generic/
│   ├── steps/                      Post-agent steps
│   │   ├── add-mcp-server-to-clients/  MCP installation (6 editors)
│   │   ├── upload-environment-variables/  Vercel env push
│   │   ├── add-or-update-environment-variables.ts
│   │   └── run-prettier.ts
│   └── utils/                      ~27 utility modules
│       ├── oauth.ts                OAuth PKCE flow
│       ├── analytics.ts            Amplitude telemetry
│       ├── api-key-store.ts        API key persistence (keychain/.env.local)
│       ├── ampli-settings.ts       ~/.ampli.json management
│       ├── token-refresh.ts        Silent OAuth token refresh
│       ├── atomic-write.ts         Crash-safe JSON file writes
│       ├── urls.ts                 Regional URL construction
│       ├── debug.ts                File logging
│       └── ...
├── skills/
│   ├── integration/                Per-framework SDK guides (34)
│   ├── instrumentation/            Event discovery skills (5)
│   └── taxonomy/                   Taxonomy agent skills (1)
├── docs/
│   ├── flows.md                    Flow diagrams (source of truth for UX)
│   ├── mcp-installation.md         MCP editor installation
│   ├── releasing.md                Release process and security controls
│   └── architecture.md             This document
├── features/                       BDD test features (Cucumber)
├── e2e-tests/                      End-to-end tests
├── .github/
│   ├── workflows/                  CI/CD (8 workflows)
│   └── CODEOWNERS                  Require maintainer review on key files
├── release-please-config.json      Beta prerelease configuration
└── .release-please-manifest.json   Current version tracker
```
