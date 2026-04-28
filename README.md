# Amplitude Wizard

Set up Amplitude analytics in your app — from zero to first chart — with one
command.

```bash
npx @amplitude/wizard
```

The wizard authenticates you, detects your framework, runs an AI agent to
instrument the SDK and events, verifies data is flowing, and walks you through
your first chart and dashboard. All from the terminal.

Requires Node.js >= 20.

## Supported frameworks

| Web | Python | Mobile | Game Engines | Other |
|-----|--------|--------|--------------|-------|
| Next.js | Django | Swift (iOS) | Unity | Go |
| Vue | Flask | React Native | Unreal | Java |
| React Router | FastAPI | Android | | |
| JavaScript (web) | Python (generic) | Flutter | | |
| JavaScript (Node.js) | | | | |

Unrecognized frameworks fall back to a generic integration.

## How it works

```
npx @amplitude/wizard

  ✓ Welcome  ✓ Auth  ● Setup  ○ Verify  ○ Done
  ─────────────────────────────────────────────

  Detecting framework... Found Next.js 15

  The agent is setting up Amplitude in your project.
  Current file: src/app/layout.tsx
  Tasks: 3/5 complete · 42s elapsed

  ❯ _

  [/] Commands  [Tab] Ask a question
```

1. **Sign in** — authenticates with your Amplitude account (or creates one)
2. **Detect** — identifies your framework and project structure
3. **Instrument** — proposes an event plan for your review, then writes the code
4. **Verify** — confirms events are flowing into Amplitude
5. **Explore** — walks you through your first chart, dashboard, and taxonomy

Type `/help` at any time to see available commands.

## Running modes

**Interactive** (default) — rich terminal UI with progress, slash commands, and
inline guidance:

```bash
npx @amplitude/wizard
```

**CI** — no prompts, no colors, for pipelines:

```bash
npx @amplitude/wizard --ci --api-key <key> --install-dir .
```

**Agent** — streams NDJSON for programmatic consumption:

```bash
npx @amplitude/wizard --agent --install-dir . --api-key <key>
```

## Using with AI coding agents

AI coding agents can drive the wizard end-to-end. Point your agent at the
CLI and it will detect the framework, check project state, and report back
as JSON — no prompt parsing required.

**Kick it off from your agent:**

```
> Set up Amplitude on this project.
```

The agent will typically run:

```bash
npx @amplitude/wizard manifest            # introspect the CLI surface (JSON)
npx @amplitude/wizard detect --json       # detect framework
npx @amplitude/wizard status --json       # get full project state
npx @amplitude/wizard auth status --json  # check if the human is logged in
npx @amplitude/wizard plan --json         # build a setup plan (no writes) → planId
npx @amplitude/wizard apply --plan-id <id> --yes   # execute a previously generated plan
npx @amplitude/wizard verify --json       # confirm SDK + API key + framework are in place
npx @amplitude/wizard --agent             # run the full wizard in NDJSON mode
```

> `npx @amplitude/wizard` works without installation. If the package is
> globally installed (`npm install -g @amplitude/wizard`), the shorter
> `amplitude-wizard` bin resolves to the same entry point.

**Authentication in-the-loop.** OAuth login requires a browser click — that's
the one moment a human has to step in. Everything else is scriptable:

```bash
# Option 1: inline project API key (preferred for CI / full automation)
npx @amplitude/wizard --agent --install-dir . --api-key <key>

# Option 2: prior login on the same machine, then run
npx @amplitude/wizard login                 # one-time browser click
npx @amplitude/wizard --agent --install-dir .

# Option 3: read the stored OAuth token for other scripts
npx @amplitude/wizard auth token            # stdout: <access-token>
```

**Agent-friendly verbs:**

| Command | Output | Purpose |
|---------|--------|---------|
| `manifest` | JSON | Machine-readable CLI surface (flags, env vars, exit codes, glossary) |
| `detect [--json]` | JSON or human | Detect the framework |
| `status [--json]` | JSON or human | Full project state: framework, SDK, API key, auth |
| `plan [--json]` | JSON or human | Build a structured setup plan (framework, SDK, file changes); persists a `planId` for 24h. No writes. |
| `apply --plan-id <id> --yes` | NDJSON or human | Execute a previously generated plan. Requires `--yes`; pair with `--force` for destructive overwrites. |
| `verify [--json]` | JSON or human | Cheap, no-network check that SDK + API key + framework are all in place. Exits non-zero on failure. |
| `auth status [--json]` | JSON or human | Login state + token expiry |
| `auth token` | raw token or JSON | Print stored OAuth token for scripts |

All commands auto-emit JSON when stdout is piped. Use `--human` to override
and force human-readable output. `--json` enables JSON output without the
auto-approve side effects of `--agent` (so you can script but still get
prompted for confirmation when needed).

**Plan / apply / verify.** For orchestrators that want a human in the loop on
the diff, split the run into three phases: `plan` builds a `WizardPlan`
(framework, SDK, intended file changes) and returns a `planId`; `apply
--plan-id <id> --yes` executes it within 24 hours; `verify` confirms the
result. `plan` and `verify` never write to disk. The `plan` JSON output
includes a ready-to-run `resumeFlags` array — feed it straight back into
`apply`.

**Selecting an Amplitude project.** Amplitude's hierarchy is
Org → Project → Environment → App. When multiple match, pick one with a
flag — `--project-id` is unambiguous; the others narrow when needed:

| Flag | When to use |
|------|-------------|
| `--project-id <id>` | Numeric app/environment ID (e.g. `769610`). Most unambiguous selector. |
| `--workspace-id <uuid>` | Narrow to one project when env names collide. (Flag name kept for backward compat with the ampli CLI; scopes to an Amplitude Project.) |
| `--org <name>` | Case-insensitive partial match on org name. |
| `--env <name>` | Amplitude environment (e.g. `Production`). NOT a POSIX env var. |

When running `--agent` without a selector and the user has multiple
projects, the wizard emits a `prompt` event with `promptType:
"environment_selection"` carrying a flat `choices` array plus pre-built
`resumeFlags` so the orchestrator can show the human a picker and
re-invoke with the chosen flags. Run `amplitude-wizard manifest` for the
full glossary.

**Environment variables:**

| Var | Effect |
|-----|--------|
| `AMPLITUDE_WIZARD_API_KEY` | Amplitude project API key (= `--api-key`) |
| `AMPLITUDE_TOKEN` | OAuth access-token override (requires prior login) |
| `AMPLITUDE_WIZARD_TOKEN` | Alias for `AMPLITUDE_TOKEN` |
| `AMPLITUDE_WIZARD_AGENT=1` | Force agent mode (NDJSON, auto-approve) |
| `AMPLITUDE_WIZARD_MAX_TURNS` | Override the inner agent's per-run turn cap (default 200) |

**NDJSON schema.** Every event emitted in `--agent` mode carries a `v:1`
version tag and a typed envelope. The stream includes inner-agent
`lifecycle` events plus `file_change` events for every write the agent
makes — orchestrators can render a live diff without tailing the
filesystem. See
[docs/dual-mode-architecture.md](./docs/dual-mode-architecture.md) for the
full schema and deprecation policy.

**Auth-required signal.** When an agent-mode run starts without valid
credentials, the wizard emits a structured `lifecycle` event and exits with
code `3` (`AUTH_REQUIRED`) instead of a plain error log. Orchestrators can
surface the instruction to the human, trigger the login, then re-run:

```json
{
  "v": 1,
  "type": "lifecycle",
  "level": "error",
  "message": "Not signed in to Amplitude. Ask the user to run `npx @amplitude/wizard login`...",
  "data": {
    "event": "auth_required",
    "reason": "no_stored_credentials",
    "loginCommand": ["npx", "@amplitude/wizard", "login"],
    "resumeCommand": ["npx", "@amplitude/wizard", "--agent"]
  }
}
```

Reason values: `no_stored_credentials`, `token_expired`, `refresh_failed`,
`env_selection_failed`.

**Nested-invocation signal.** Running the wizard from inside another AI
coding agent session is supported. The wizard spawns its own agent
subprocess for the setup agent, and inherited env vars from the outer
session (`CLAUDECODE=1`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_OAUTH_TOKEN`,
`CLAUDE_AGENT_SDK_VERSION`, etc.) would otherwise leak into the inner
subprocess and cause the LLM gateway to reject requests with a 400. The
wizard strips those vars before spawning, so nested runs succeed.

When nesting is detected the wizard emits a diagnostic so outer agent
orchestrators can log the signal:

```json
{
  "v": 1,
  "type": "lifecycle",
  "level": "info",
  "message": "Detected nested agent invocation via CLAUDECODE=1...",
  "data": {
    "event": "nested_agent",
    "signal": "claude_code_cli",
    "detectedEnvVar": "CLAUDECODE",
    "bypassEnv": "AMPLITUDE_WIZARD_ALLOW_NESTED"
  }
}
```

Detection looks for `CLAUDECODE=1` or `CLAUDE_CODE_ENTRYPOINT` env vars. Set
`AMPLITUDE_WIZARD_ALLOW_NESTED=1` to skip the diagnostic entirely
(sanitization still runs).

### MCP server

`npx @amplitude/wizard mcp serve` exposes the wizard's read-only operations as
[Model Context Protocol](https://modelcontextprotocol.io) tools over stdio.
AI coding agents call them directly as typed tools instead of spawning the
CLI and parsing output. Add to your MCP client's config:

```json
{
  "mcpServers": {
    "amplitude-wizard": {
      "command": "npx",
      "args": ["-y", "@amplitude/wizard", "mcp", "serve"]
    }
  }
}
```

If you've installed globally (`npm install -g @amplitude/wizard`), you can
use the bin directly:

```json
{
  "mcpServers": {
    "amplitude-wizard": {
      "command": "amplitude-wizard",
      "args": ["mcp", "serve"]
    }
  }
}
```

Tools exposed:

| Tool | Purpose |
|------|---------|
| `detect_framework` | Detect the framework used in a project |
| `get_project_status` | Full setup state: framework, SDK, API key, auth |
| `plan_setup` | Build a `WizardPlan` (framework, SDK, intended file changes) and return a `planId`. Read-only — no writes. Pair with the `apply` CLI subcommand to execute. |
| `verify_setup` | No-network check that SDK + API key + framework are all in place. Returns `{ outcome, failures }`. |
| `get_auth_status` | Whether the user is logged in and when their token expires |
| `get_auth_token` | Return the stored OAuth access token (security-sensitive) |

## Commands

Available at any point during the wizard:

| Command | Description |
|---------|-------------|
| `/help` | List available commands |
| `/whoami` | Show current user, org, project, and region |
| `/org` | Switch the active org |
| `/project` | Switch the active project |
| `/region` | Switch data-center region (US / EU) |
| `/login` | Re-authenticate |
| `/logout` | Clear credentials |
| `/chart` | Set up a new chart |
| `/dashboard` | Create a new dashboard |
| `/taxonomy` | Interact with the taxonomy agent |
| `/overview` | Open the project overview in the browser |
| `/slack` | Connect your Amplitude project to Slack |
| `/feedback` | Send product feedback |

## Session and credentials

The wizard remembers your login, org, project, and region across runs. Expired
sessions refresh silently — you won't be asked to re-authenticate unless
necessary. If the wizard is interrupted, the next launch in the same directory
picks up where you left off.

Credentials are stored in `~/.ampli.json` with restricted permissions. Project
settings live in `.ampli.json` in your project directory (safe to commit for
team sharing). API keys use your OS keychain when available, otherwise
`.env.local` (gitignored).

## CLI reference

<details>
<summary>Flags and exit codes</summary>

### Global options

| Flag | Env var | Description |
|------|---------|-------------|
| `--debug` | `AMPLITUDE_WIZARD_DEBUG` | Enable verbose logging |
| `--verbose` | `AMPLITUDE_WIZARD_VERBOSE` | Print diagnostic info to the log |
| `--signup` | `AMPLITUDE_WIZARD_SIGNUP` | Create a new Amplitude account during setup |
| `--local-mcp` | `AMPLITUDE_WIZARD_LOCAL_MCP` | Use local MCP server at `http://localhost:8787/mcp` |
| `--ci` | `AMPLITUDE_WIZARD_CI` | Non-interactive execution |
| `--api-key <key>` | `AMPLITUDE_WIZARD_API_KEY` | Amplitude API key (skips OAuth) |
| `--project-id <id>` | `AMPLITUDE_WIZARD_PROJECT_ID` | Amplitude project ID |

### Wizard options

| Flag | Env var | Description |
|------|---------|-------------|
| `--install-dir <dir>` | `AMPLITUDE_WIZARD_INSTALL_DIR` | Directory to install in (required for CI/agent) |
| `--agent` | `AMPLITUDE_WIZARD_AGENT` | NDJSON output + auto-approve prompts |
| `--json` | — | Machine-readable JSON (does NOT auto-approve prompts) |
| `--human` | — | Force human output (overrides `--json` auto-detect when piped) |
| `--yes` / `-y` | `AMPLITUDE_WIZARD_YES` | Skip all prompts and allow the inner agent to write files (required for `apply`) |
| `--auto-approve` | `AMPLITUDE_WIZARD_AUTO_APPROVE` | Silently pick the recommended choice on `needs_input` prompts. Does **not** grant write capability — pair with `--yes` for that. |
| `--force` | `AMPLITUDE_WIZARD_FORCE` | Allow destructive writes (overwrite/delete existing files); implies `--yes`. |
| `--integration <name>` | — | Force a specific integration |
| `--menu` | `AMPLITUDE_WIZARD_MENU` | Show framework selection menu |
| `--force-install` | `AMPLITUDE_WIZARD_FORCE_INSTALL` | Install packages even if peer checks fail |
| `--benchmark` | `AMPLITUDE_WIZARD_BENCHMARK` | Per-phase token tracking |

### Agent / scripting env vars

| Env var | Effect |
|---------|--------|
| `AMPLITUDE_TOKEN` | OAuth access-token override (requires prior `amplitude-wizard login`) |
| `AMPLITUDE_WIZARD_TOKEN` | Alias for `AMPLITUDE_TOKEN` |
| `AMPLITUDE_WIZARD_MAX_TURNS` | Override the inner agent's per-run turn cap (default 200, max 10000). Useful for very long-running setups. |

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
| 3 | Authentication required |
| 4 | Network error |
| 10 | Agent failed |
| 130 | User cancelled |

</details>

---

## For developers

### Setup

```bash
pnpm install
pnpm build
pnpm try          # run the wizard from source (no build needed)
```

### Project structure

| Path | Role |
|------|------|
| `bin.ts` | CLI entry point — yargs commands, flags, mode selection |
| `src/run.ts` | Main wizard orchestration |
| `src/ui/tui/` | Terminal UI — [Ink](https://github.com/vadimdemedes/ink) (React for CLIs) + nanostores |
| `src/ui/agent-ui.ts` | Agent mode — NDJSON streaming, no TUI |
| `src/lib/` | Core business logic — session, agent runner, framework configs |
| `src/frameworks/` | Per-framework integration configs (Next.js, Django, Swift, etc.) |
| `src/steps/` | Post-agent steps — MCP install, env upload, formatting |
| `skills/` | Bundled markdown instructions the AI agent follows at runtime |

See [CLAUDE.md](./CLAUDE.md) for full architecture documentation.

### Testing

```bash
pnpm test             # unit tests (vitest)
pnpm test:watch       # watch mode
pnpm test:bdd         # BDD / Cucumber tests
pnpm test:e2e         # end-to-end tests
pnpm test:proxy       # proxy health check
pnpm lint             # prettier + eslint
pnpm fix              # auto-fix lint issues
```

### Documentation

| Doc | What it covers |
|-----|---------------|
| [Flow diagrams](./docs/flows.md) | Source of truth for UX flows |
| [Architecture](./docs/architecture.md) | System design |
| [Dual-mode architecture](./docs/dual-mode-architecture.md) | TUI, agent, and CI mode |
| [External services](./docs/external-services.md) | Runtime dependencies and APIs |
| [Engineering patterns](./docs/engineering-patterns.md) | Async safety, retry, error classification |

### Natively open source
Hat tip to [PostHog's CLI](https://github.com/PostHog/wizard) for early inspiration. Amplitude's Wizard is an independent project, licensed under MIT. We welcome contributions from anyone.
