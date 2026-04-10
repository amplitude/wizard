# Amplitude Wizard CLI — Architecture

> `npx @amplitude/wizard` — an AI-powered CLI that instruments apps with Amplitude analytics.

The wizard authenticates the user, detects their framework, runs a Claude-powered
agent to install the SDK and instrument events, then guides them through first
chart, first dashboard, and Slack integration.

---

## The binary

```
package.json → "bin": { "amplitude-wizard": "dist/bin.js" }
```

`bin.ts` is the entry point. It uses yargs to define **9 top-level commands**:

| Command | What it does |
|---------|-------------|
| _(default)_ | Run the wizard (interactive TUI or `--ci` mode) |
| `login` | OAuth PKCE flow → store token in `~/.ampli.json` |
| `logout` | Clear stored credentials |
| `whoami` | Show current user, org, project, region |
| `feedback` | Submit product feedback |
| `slack` | Connect Amplitude project to Slack |
| `region` | Switch data-center region (US / EU) |
| `mcp add` / `mcp remove` | Install or remove the Amplitude MCP server in editors |
| `completion` | Generate shell completions (zsh/bash) |

### Startup sequence (default wizard command)

```
bin.ts
 │
 ├─ Check Node.js >= 18.17.0
 ├─ Load .env via dotenv
 ├─ Initialize Amplitude telemetry (analytics-node)
 ├─ Initialize feature flags (experiment-node-server)
 ├─ Detect TTY → choose TUI (Ink) or LoggingUI (CI)
 ├─ Read stored OAuth token from ~/.ampli.json
 ├─ Fire concurrent:
 │   ├─ OAuth pre-check / refresh
 │   └─ Framework auto-detection (scan package.json, pyproject.toml, etc.)
 │
 └─ Call run.ts → runWizard(args, session)
      │
      ├─ Call framework's gatherContext() if defined
      └─ Call runAgentWizard() → spawn Claude agent
```

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
│  │         │                           │ + 5 overlays            │  │  │
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
│  Amplitude LLM Proxy                                                │
│  core.amplitude.com/wizard  (US)                                    │
│  core.eu.amplitude.com/wizard (EU)                                  │
│                                                                     │
│  Validates OAuth token → forwards to GCP Vertex AI → Claude         │
│  Endpoints: /health, /v1/models, /v1/messages                       │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  GCP Vertex AI      │
                    │  (rawPredict /      │
                    │   streamRawPredict) │
                    │       ↓             │
                    │   Claude model      │
                    └─────────────────────┘
```

---

## External dependencies (non-npm)

These are **services and sibling repos** the wizard depends on at runtime or
development time — not npm packages.

### Runtime services

| Dependency | Role | How the wizard talks to it |
|-----------|------|---------------------------|
| **Amplitude OAuth** (`core.amplitude.com/oauth2`) | User authentication (PKCE flow) | Local HTTP server on port 13222 receives callback; token stored in `~/.ampli.json` |
| **Amplitude LLM Proxy** (`core.amplitude.com/wizard`) | Routes Claude API calls through Vertex AI so users never need an Anthropic key | `ANTHROPIC_BASE_URL` env var → Claude Agent SDK sends requests here |
| **GCP Vertex AI** | Hosts the Claude model | Proxy forwards; wizard never talks to it directly |
| **Amplitude API** (`core.amplitude.com/api`) | Org/project listing, activation checks, API key validation | REST calls from AuthScreen and DataSetupScreen |
| **Amplitude MCP Server** (`mcp.amplitude.com/mcp`) | Gives Claude (in the user's editor) access to Amplitude tools | Wizard writes the server URL into editor configs; editors handle OAuth themselves |
| **Amplitude Experiment** | Feature flag evaluation (LLM analytics, agent analytics flags) | Local evaluation via `@amplitude/experiment-node-server` |
| **GitHub Releases** (`github.com/amplitude/wizard`) | Hosts downloadable skill bundles for the agent | `wizard-tools.ts` fetches skill menu and downloads skills on demand |

### Development-time dependencies

| Dependency | Role |
|-----------|------|
| **amplitude/javascript** repo (sibling) | The local LLM proxy (`pnpm proxy`) loads proxy code from `../javascript`. Override with `JS_REPO=` env var |
| **aws-sso** (`us-prod-dev` profile) | Credentials for the local proxy to reach GCP |
| **~/.ampli.json** | Shared credential store with the `ampli` CLI (amplitude/ampli repo) |

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
AuthScreen (SUSI flow)        OAuth → org picker → workspace picker → API key
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
- `OutageScreen` — Claude API unavailable
- `SettingsOverrideScreen` — `.claude/settings.json` has blocking keys

---

## Architectural layers

### 1. CLI layer (`bin.ts`, `src/run.ts`)

Parses arguments, initializes services, builds `WizardSession`, and hands off to
the TUI or CI runner. Owns the boundary between "CLI tool" and "wizard logic."

### 2. TUI layer (`src/ui/tui/`)

Built with **Ink** (React for terminals) and **nanostores** for reactive state.

| Component | Purpose |
|-----------|---------|
| `WizardRouter` | Walks a declarative flow pipeline to resolve the active screen. Maintains an overlay stack for interruptions |
| `flows.ts` | Declares 5 flow pipelines (Wizard, McpAdd, McpRemove, SlackSetup, RegionSelect) as arrays of `{ screen, show, isComplete }` entries |
| `WizardStore` | Nanostore atoms wrapping `WizardSession` — reactive setters trigger re-renders |
| `screen-registry.tsx` | Maps `Screen` enum values to React components |
| `console-commands.ts` | Slash command definitions and dispatch |
| `screens/` | 16 screen components, one file each |

**Key rule**: Screens are passive. They read from the store and call store setters.
The router derives the active screen from session state — screens never navigate
directly.

### 3. Agent layer (`src/lib/`)

| Component | Purpose |
|-----------|---------|
| `agent-runner.ts` | Orchestrates the full agent run: version check → status check → TS detection → spawn agent |
| `agent-interface.ts` | Lazy-loads `@anthropic-ai/claude-agent-sdk`, resolves the `claude` CLI binary, defines `AgentSignals` |
| `commandments.ts` | System prompt rules always appended: no hallucinated secrets, use wizard-tools MCP, read before write, call `confirm_event_plan` before instrumenting |
| `wizard-tools.ts` | In-process MCP server exposing `check_env_keys`, `set_env_values`, `detect_package_manager`, `confirm_event_plan`, plus remote skill downloading |
| `safe-tools.ts` | Allowlist of ~100 linting/formatting tools the agent sandbox permits |
| `agent-hooks.ts` | Lifecycle callbacks (stop, tool use, etc.) |

### 4. Framework layer (`src/frameworks/`, `src/lib/framework-config.ts`, `src/lib/registry.ts`)

Every supported framework implements the `FrameworkConfig<TContext>` interface:

```typescript
interface FrameworkConfig<TContext> {
  integration: Integration;
  displayName: string;
  detect(dir: string): Promise<boolean>;     // auto-detection
  gatherContext?(dir: string): Promise<TContext>; // pre-agent context
  buildPrompt(ctx: TContext): string;         // agent system prompt
  envKeys: string[];                          // required env vars
  setupQuestions?: SetupQuestion[];           // disambiguation UI
  // ... analytics, ui sections, etc.
}
```

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
- **Environment variable upload** — push `.env` values to hosting providers
- **Prettier** — format code the agent touched

### 6. Skills (`skills/`)

Bundled markdown instructions that the agent follows during runs:

| Directory | Content | Count |
|-----------|---------|-------|
| `skills/integration/` | Per-framework SDK setup guides | 34 |
| `skills/instrumentation/` | Event discovery and pattern matching | varies |
| `skills/taxonomy/` | Quickstart taxonomy agent | 1 |

Integration and instrumentation skills are auto-refreshed via GitHub Actions
workflows (`pnpm skills:refresh`).

### 7. Utilities (`src/utils/`)

~27 files covering: OAuth flow, analytics tracking, API key persistence
(`~/.ampli.json` and system keychain), environment handling, package manager
detection, URL construction, debug logging, shell completions, and more.

---

## State management

```
WizardSession (src/lib/wizard-session.ts)
│
├─ CLI args (framework, region, ci mode, flags)
├─ Detection results (integration, typescript, features)
├─ OAuth credentials (token, userId, orgId, workspaceId)
├─ API key + region
├─ Run tracking (runPhase: idle → running → completed/error)
├─ Activation level (none / partial / full)
├─ MCP outcome, Slack outcome
├─ Feature discovery (Stripe, LLM packages)
└─ Outro kind (success / error / cancel)

WizardStore (src/ui/tui/store.ts)
│
├─ Wraps WizardSession in Nanostore atoms
├─ Provides typed setter methods
├─ Subscribers are notified reactively
└─ Router re-resolves active screen on every update
```

---

## How the agent works

```
Agent Runner
 │
 ├─ Builds system prompt:
 │   ├─ Framework-specific prompt (from FrameworkConfig.buildPrompt)
 │   ├─ Commandments (always-on rules from commandments.ts)
 │   └─ Relevant skills (integration + instrumentation markdown)
 │
 ├─ Attaches MCP servers:
 │   ├─ wizard-tools (in-process) — env vars, package manager, event plan
 │   └─ filesystem tools (from safe-tools allowlist)
 │
 ├─ Spawns Claude Agent SDK subprocess:
 │   ├─ ANTHROPIC_BASE_URL = proxy URL
 │   ├─ ANTHROPIC_AUTH_TOKEN = user's OAuth token
 │   └─ claude CLI binary (resolved from SDK package)
 │
 └─ Agent execution:
      1. Read project files to understand structure
      2. Install Amplitude SDK + initialization code
      3. Scan codebase for instrumentable locations
      4. Call confirm_event_plan tool → user approves/edits event list
      5. Write track() calls at approved locations
      6. Detect features (Stripe, LLM) → show tips
      7. Upload env vars to hosting if configured
```

---

## Authentication flow

```
User runs wizard
     │
     ├─ Check ~/.ampli.json for existing token
     │   ├─ Valid → skip OAuth, auto-detect region from token
     │   └─ Missing/expired → start OAuth
     │
     ▼
OAuth PKCE flow
     │
     ├─ Open browser → core.amplitude.com/oauth2/authorize
     ├─ Local HTTP server on port 13222 receives callback
     ├─ Exchange code for token
     ├─ Store token + user info in ~/.ampli.json
     └─ Auto-detect region (US/EU) from token claims
           │
           ▼
     Org picker (if multiple) → Workspace picker (if multiple) → API key
```

---

## CI/CD

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `build.yml` | Push / PR | Build, lint, unit tests (Node 20/22/24 matrix), Codecov |
| `behavior-driven-tests.yml` | Push / PR | Cucumber BDD tests |
| `pr-conventional-commit.yml` | PR | Validates PR title follows conventional commits |
| `publish.yml` | Release / manual | npm publish with OIDC provenance under `beta` dist-tag; requires `npm-publish` environment approval |
| `release-please.yml` | Push to main | Automated version bump, changelog, release PR, and publish via conventional commits |
| `refresh-integration-skills.yml` | Schedule | Auto-update integration skill bundles |
| `refresh-instrumentation-skills.yml` | Schedule | Auto-update instrumentation skill bundles |
| `wizard-ci-trigger.yml` | Various | Downstream CI triggers |

### Release process

All releases are currently **beta prereleases** (`1.0.0-beta.N`) published under
the `beta` npm dist-tag. The automated flow:

```
PR merged to main (conventional commit)
  → release-please creates/updates a release PR (version bump + CHANGELOG)
  → Merge the release PR → GitHub Release + tag created
  → growth team approves the npm-publish environment
  → Published to npm with OIDC provenance
```

Security controls: OIDC trusted publishing (no static npm tokens), `--provenance`
supply-chain attestation, SHA-pinned actions, and CODEOWNERS requiring growth team
review on workflow/manifest changes.

See [`docs/releasing.md`](./releasing.md) for full details.

---

## Key constants

| Constant | Value | Defined in |
|----------|-------|-----------|
| npm package | `@amplitude/wizard` | `package.json` |
| Binary name | `amplitude-wizard` | `package.json` |
| OAuth callback port | `13222` | `src/lib/constants.ts` |
| LLM proxy (US) | `https://core.amplitude.com/wizard` | `src/utils/urls.ts` |
| LLM proxy (EU) | `https://core.eu.amplitude.com/wizard` | `src/utils/urls.ts` |
| MCP server (US) | `https://mcp.amplitude.com/mcp` | `src/steps/.../defaults.ts` |
| MCP server (EU) | `https://mcp.eu.amplitude.com/mcp` | `src/steps/.../defaults.ts` |
| Node.js minimum | `18.17.0` | `bin.ts` |
| Credential store | `~/.ampli.json` | `src/utils/ampli-settings.ts` |

---

## Directory map

```
amplitude/wizard
├── bin.ts                          CLI entry point (yargs commands)
├── src/
│   ├── run.ts                      Main wizard orchestration
│   ├── lib/
│   │   ├── wizard-session.ts       Session state (single source of truth)
│   │   ├── agent-runner.ts         Agent orchestration
│   │   ├── agent-interface.ts      Claude Agent SDK integration
│   │   ├── agent-hooks.ts          Agent lifecycle callbacks
│   │   ├── commandments.ts         Always-on system prompt rules
│   │   ├── framework-config.ts     FrameworkConfig interface
│   │   ├── registry.ts             FRAMEWORK_REGISTRY (18 frameworks)
│   │   ├── constants.ts            Integration enum, URLs, env flags
│   │   ├── wizard-tools.ts         In-process MCP server + skill loader
│   │   ├── safe-tools.ts           Agent tool allowlist (~100 tools)
│   │   └── feature-flags.ts        Amplitude Experiment flags
│   ├── ui/tui/
│   │   ├── App.tsx                 Root Ink component
│   │   ├── router.ts              Declarative flow router + overlay stack
│   │   ├── flows.ts               Flow pipeline definitions (5 flows)
│   │   ├── store.ts               Nanostore reactive state
│   │   ├── screen-registry.tsx    Screen → component mapping
│   │   ├── console-commands.ts    Slash command definitions
│   │   ├── screens/               16 screen components
│   │   ├── components/            Shared UI components
│   │   ├── primitives/            Low-level UI building blocks
│   │   └── services/              TUI service modules
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
│   │   ├── upload-environment-variables/
│   │   └── run-prettier.ts
│   └── utils/                      ~27 utility modules
│       ├── oauth.ts                OAuth PKCE flow
│       ├── analytics.ts            Amplitude telemetry
│       ├── api-key-store.ts        API key persistence
│       ├── ampli-settings.ts       ~/.ampli.json management
│       ├── urls.ts                 Regional URL construction
│       └── ...
├── skills/
│   ├── integration/                Per-framework SDK guides (34)
│   ├── instrumentation/            Event discovery skills
│   └── taxonomy/                   Taxonomy agent skills
├── docs/
│   ├── flows.md                    Flow diagrams (source of truth for UX)
│   ├── llm-proxy.md               Proxy architecture
│   ├── mcp-installation.md         MCP editor installation
│   ├── releasing.md                Release process and security controls
│   └── architecture.md             This document
├── features/                       BDD test features (Cucumber)
├── e2e-tests/                      End-to-end tests
├── .github/
│   ├── workflows/                  CI/CD (8 workflows)
│   └── CODEOWNERS                  Require growth team review on key files
├── release-please-config.json      Beta prerelease configuration
└── .release-please-manifest.json   Current version tracker
```
