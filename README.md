# Amplitude Wizard

An interactive CLI that guides developers through instrumenting their app with
Amplitude analytics. It detects your framework, authenticates with your
Amplitude account, runs a Claude-powered agent to set up the SDK and events, and
walks you through your first chart and dashboard.

## Quick start

```bash
npx @amplitude/wizard
```

Requires Node.js >= 18.17.0.

## How it works

The wizard keeps a persistent prompt open throughout the session — like Claude
Code — so slash commands can be run at any time to switch org, switch project,
re-authenticate, or trigger actions like opening a chart or interacting with the
taxonomy agent.

On first run, the wizard:

1. Checks for existing Amplitude credentials (`~/.ampli.json`)
2. If not authenticated, walks through sign up or sign in (SUSI), org and
   project selection
3. Evaluates activation status — whether events are being ingested and the SDK
   is configured
4. If the project has no data yet, detects your framework and runs the agent to
   instrument your app
5. If the project already has data, offers options to explore your analytics or
   set up a new project
6. After instrumentation, guides you through the taxonomy agent, first chart,
   and first dashboard

See [`docs/flows.md`](./docs/flows.md) for detailed flow diagrams.

## Supported frameworks

**Web / JavaScript:**
Next.js, Vue, React Router, JavaScript (web), JavaScript (Node.js)

**Python:**
Django, Flask, FastAPI, Python (generic)

**Mobile:**
Swift (iOS), React Native, Android, Flutter

**Game engines:**
Unity, Unreal

**Other:**
Go, Java

A generic fallback handles unrecognized frameworks.

## Modes

### Interactive TUI (default)

```bash
npx @amplitude/wizard
```

Rich terminal UI with screens, progress indicators, and slash commands.
Pass `--tui-v2` (or set `AMPLITUDE_TUI_V2=1`) for the redesigned TUI.

### CI mode

Non-interactive execution for pipelines. No prompts, no colors.

```bash
npx @amplitude/wizard --ci --api-key <key> --install-dir .
```

`--yes` / `-y` is an alias for `--ci`. Requires `--install-dir`.

### Agent mode

Structured NDJSON output for programmatic consumption. Auto-approves all
prompts and emits one JSON object per line to stdout.

```bash
npx @amplitude/wizard --agent --install-dir . --api-key <key>
```

Requires `--install-dir`. See [`docs/tui-v2-dual-mode-architecture.md`](./docs/tui-v2-dual-mode-architecture.md) for the NDJSON schema.

## CLI flags

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

### Wizard command options

| Flag | Env var | Description |
|------|---------|-------------|
| `--install-dir <dir>` | `AMPLITUDE_WIZARD_INSTALL_DIR` | Directory to install Amplitude in (required for CI/agent) |
| `--tui-v2` | `AMPLITUDE_TUI_V2` | Use the redesigned TUI |
| `--agent` | `AMPLITUDE_WIZARD_AGENT` | Structured JSON output mode |
| `--yes` / `-y` | — | Skip all prompts, same as `--ci` |
| `--integration <name>` | — | Force a specific integration (`nextjs`, `vue`, `react-router`, `django`, `flask`, `fastapi`, `javascript_web`, `javascript_node`, `python`) |
| `--menu` | `AMPLITUDE_WIZARD_MENU` | Show framework selection menu instead of auto-detecting |
| `--force-install` | `AMPLITUDE_WIZARD_FORCE_INSTALL` | Install packages even if peer dependency checks fail |
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

## Session storage

The wizard remembers you across runs using four persistence layers, checked in order:

1. **OAuth tokens** (`~/.ampli.json`) — access token, refresh token, user profile, zone. On restart the wizard attempts a silent token refresh (using a 365-day refresh token) before falling back to browser OAuth.

2. **API key store** — the project API key is persisted via the OS keychain (macOS Keychain / Linux `secret-tool`), falling back to `.env.local` in the project directory. Scoped per project directory.

3. **Project config** (`.ampli.json` in the project directory) — zone, org, workspace, project selections written by the Amplitude CLI toolchain.

4. **Crash-recovery checkpoint** (`$TMPDIR/amplitude-wizard-checkpoint.json`) — a sanitized session snapshot (no credentials) saved periodically. If the wizard crashes mid-run, the next launch in the same project directory restores completed setup steps (intro, region, auth selections, framework detection) so you resume where you left off. Checkpoints expire after 24 hours and are deleted on successful completion.

## Slash commands

Available at any time during the wizard session:

| Command      | Description                                                       |
| ------------ | ----------------------------------------------------------------- |
| `/region`    | Switch the data-center region (US or EU) — re-triggers data setup |
| `/org`       | Switch the active org                                             |
| `/project`   | Switch the active project                                         |
| `/login`     | Re-authenticate                                                   |
| `/logout`    | Clear credentials                                                 |
| `/whoami`    | Show current user, org, and project                               |
| `/overview`  | Open the project overview in the browser                          |
| `/chart`     | Set up a new chart                                                |
| `/dashboard` | Create a new dashboard                                            |
| `/taxonomy`  | Interact with the taxonomy agent                                  |
| `/slack`     | Connect your Amplitude project to Slack                           |
| `/feedback`  | Send product feedback                                             |
| `/help`      | List available slash commands                                     |

## Development

```bash
pnpm install
pnpm build
pnpm try          # run the wizard locally (from source, no build needed)
```

### Useful commands

```bash
pnpm test          # run unit tests (vitest)
pnpm test:watch    # run unit tests in watch mode
pnpm test:bdd      # run BDD/Cucumber tests
pnpm test:e2e      # build + run e2e tests
pnpm test:proxy    # validate proxy health, models, streaming
pnpm lint          # run prettier + eslint checks
pnpm fix           # auto-fix lint issues
pnpm flows         # render docs/flows.md diagrams to docs/diagrams/
pnpm dev           # build once, link globally, then watch + proxy in parallel
pnpm skills:refresh # refresh bundled integration/instrumentation skills
```

### Local LLM proxy

The wizard routes Claude API calls through a Langley proxy instead of hitting
Anthropic directly. For local development you need to run it alongside the wizard.

**Prerequisites:** `aws-sso` with the `us-prod-dev` profile, and the
`amplitude/javascript` repo checked out as a sibling directory (`../javascript`).
Override with `JS_REPO=/path/to/javascript`.

```bash
# Terminal 1 — start the proxy
pnpm proxy

# Terminal 2 — run the wizard with dev bypass token
WIZARD_PROXY_DEV_TOKEN=dev-token pnpm try
```

Or use `pnpm dev` to start both in one terminal (builds first, then runs
`build:watch` and the proxy in parallel).

Validate the proxy is working: `pnpm test:proxy`

### Render flow diagrams

```bash
pnpm flows
```

Renders all diagrams from `docs/flows.md` to PNGs in `docs/diagrams/`.
