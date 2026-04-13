# Amplitude Wizard

Set up Amplitude analytics in your app — from zero to first chart — with one
command.

```bash
npx @amplitude/wizard
```

The wizard authenticates you, detects your framework, runs an AI agent to
instrument the SDK and events, verifies data is flowing, and walks you through
your first chart and dashboard. All from the terminal.

Requires Node.js >= 18.17.0.

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
| `--agent` | `AMPLITUDE_WIZARD_AGENT` | Structured JSON output mode |
| `--yes` / `-y` | — | Skip all prompts, same as `--ci` |
| `--integration <name>` | — | Force a specific integration |
| `--menu` | `AMPLITUDE_WIZARD_MENU` | Show framework selection menu |
| `--force-install` | `AMPLITUDE_WIZARD_FORCE_INSTALL` | Install packages even if peer checks fail |
| `--benchmark` | `AMPLITUDE_WIZARD_BENCHMARK` | Per-phase token tracking |

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
pnpm test:proxy       # LLM proxy health check
pnpm lint             # prettier + eslint
pnpm fix              # auto-fix lint issues
```

### Local LLM proxy

The wizard routes API calls through a Langley proxy. For local development, run
it alongside the wizard.

**Prerequisites:** `aws-sso` with the `us-prod-dev` profile, and
`amplitude/javascript` checked out as a sibling directory (`../javascript`).
Override with `JS_REPO=/path/to/javascript`.

```bash
# Terminal 1 — proxy
pnpm proxy

# Terminal 2 — wizard
WIZARD_PROXY_DEV_TOKEN=dev-token pnpm try
```

Or `pnpm dev` to run both in one terminal.

### Documentation

| Doc | What it covers |
|-----|---------------|
| [Flow diagrams](./docs/flows.md) | Source of truth for UX flows |
| [Architecture](./docs/architecture.md) | System design |
| [Dual-mode architecture](./docs/dual-mode-architecture.md) | TUI, agent, and CI mode |
| [Engineering patterns](./docs/engineering-patterns.md) | Async safety, retry, error classification |
| [Migration guide](./docs/tui-migration-guide.md) | What changed in the TUI redesign |
| [Migration record](./docs/tui-migration-record.md) | Historical record of the migration |
