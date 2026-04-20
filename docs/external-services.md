# External Services & Runtime Dependencies

Everything the wizard touches at runtime beyond its own source code: APIs, OAuth flows, status pages, file system locations, CLI tools, credential storage, and environment variables.

> **Scope:** This document covers runtime dependencies only — not npm packages. For architecture details see [`architecture.md`](./architecture.md).

---

## Table of Contents

- [Amplitude APIs](#amplitude-apis)
- [OAuth Flow](#oauth-flow)
- [LLM Gateway & Agent](#llm-gateway--agent)
- [MCP Server](#mcp-server)
- [Health Checks & Status Pages](#health-checks--status-pages)
- [Telemetry](#telemetry)
- [Feature Flags](#feature-flags)
- [Credential Storage](#credential-storage)
- [File System Touchpoints](#file-system-touchpoints)
- [CLI Tools Invoked](#cli-tools-invoked)
- [Environment Variables](#environment-variables)
- [Outbound URLs (Browser)](#outbound-urls-browser)

---

## Amplitude APIs

### Data API (GraphQL)

The primary backend for user/org/workspace discovery after authentication.

| Zone | Endpoint |
|------|----------|
| US | `https://data-api.amplitude.com/graphql` |
| EU | `https://data-api.eu.amplitude.com/graphql` |

**Auth:** `Authorization: Bearer <idToken>` (OAuth ID token).

**Main query** — `orgs` (from `src/lib/api.ts`):

```graphql
query orgs {
  orgs {
    id
    name
    user { id firstName lastName email }
    workspaces {
      id
      name
      environments {
        name
        rank
        app { id apiKey }
      }
    }
  }
}
```

Used to populate org/workspace/project pickers and resolve the API key for the selected project.

### App API (GraphQL)

Org-scoped endpoint for app-level operations (charts, dashboards, Slack, activation status).

**Auth:** `Authorization: Bearer <accessToken>` (OAuth access token).

**Queries used** (from `src/lib/api.ts`):

| Query | Purpose |
|-------|---------|
| `OwnedDashboards` | Fetch user's dashboards and chart IDs (ChecklistScreen) |
| `hasAnyDefaultEventTrackingSourceAndEvents` | Project activation status (DataSetupScreen) |
| `SlackInstallUrl` | Direct Slack OAuth install URL (SlackScreen) |
| `SlackConnectionStatus` | Check if Slack is already connected (SlackScreen) |

### Web App URLs

Deep-links opened in the user's browser for chart creation, dashboard creation, and settings.

| Zone | App Base | Overview Base |
|------|----------|---------------|
| US | `https://app.amplitude.com` | `https://app.amplitude.com` |
| EU | `https://app.eu.amplitude.com` | `https://eu.amplitude.com` |

Used to construct: `/chart/new`, `/dashboard/new`, `/settings/profile`, `/products?source=wizard`.

---

## OAuth Flow

**Protocol:** OAuth 2.0 Authorization Code with PKCE.

| Component | US | EU |
|-----------|----|----|
| Auth Host | `https://auth.amplitude.com` | `https://auth.eu.amplitude.com` |
| Authorization URL | `<authHost>/oauth2/auth` | `<authHost>/oauth2/auth` |
| Client ID | `0ac84169-c41c-4222-885b-31469c761cb0` | `110d04a1-8e60-4157-9c43-fcbe4e014a85` |
| Local Redirect Port | `13222` | `13222` |

**Overridable via env:** `OAUTH_HOST`, `OAUTH_CLIENT_ID`.

**Flow:**
1. Wizard starts a local HTTP server on port `13222`
2. Opens the authorization URL in the user's default browser
3. User authenticates on `auth.amplitude.com`
4. Browser redirects back to `http://localhost:13222/callback` with the auth code
5. Wizard exchanges the code for tokens (ID token + refresh token)
6. Tokens are persisted to `~/.ampli.json` for session reuse

**Token reuse:** On subsequent runs, the wizard reads `~/.ampli.json` and validates the stored ID token against the Data API before showing the auth screen.

---

## LLM Gateway & Agent

The wizard routes all Claude API calls through Amplitude's LLM gateway, which validates OAuth tokens and forwards requests to Claude.

**Agent SDK:** `@anthropic-ai/claude-agent-sdk` — creates a persistent agent session with tool permissions, MCP server connections, and hook callbacks. The agent runs inside the wizard process.

---

## MCP Server

Amplitude's remote MCP (Model Context Protocol) server provides the agent with Amplitude product tools.

| Environment | Base URL |
|-------------|----------|
| Production | `https://mcp.amplitude.com` |
| Local dev | `http://localhost:8787` |

**Transport variants:**
- SSE: `<base>/sse`
- Streamable HTTP: `<base>/mcp`

**Auth:** `Authorization: Bearer <apiKey>` (Amplitude project API key).

**Feature filtering:** Optional query parameter `?features=dashboards,insights,experiments,...` limits which tool categories are exposed. All features are included by default when the param is omitted.

**Health check:** `GET https://mcp.amplitude.com/` (5000ms timeout).

### In-Process MCP Server (wizard-tools)

The wizard also runs a local MCP server in-process (`src/lib/wizard-tools.ts`) providing 8 tools to the agent:

| Tool | Purpose |
|------|---------|
| `check_env_keys` | Check which env vars are set in the project |
| `set_env_values` | Write env vars to `.env.local` |
| `detect_package_manager` | Detect npm/yarn/pnpm/bun/pip/etc. |
| `load_skill_menu` | Fetch the skill menu for the detected framework |
| `install_skill` | Download and install a skill from the remote registry |
| `confirm` | Prompt the user for yes/no confirmation |
| `choose` | Prompt the user to select from options |
| `confirm_event_plan` | Present the event tracking plan for user approval before writing `track()` calls |

---

## Health Checks & Status Pages

The wizard monitors 7+ external services via Statuspage.io v2 API and direct endpoint pings. Results are displayed in the `OutageOverlay` when degradation is detected.

### Statuspage.io v2 API Checks

All use `GET` with no auth. Response shape: `{ status: { indicator: "none" | "minor" | "major" | "critical" } }`.

| Service | Status URL | Components URL |
|---------|-----------|----------------|
| Claude/Anthropic | `https://status.claude.com/api/v2/status.json` | — |
| Amplitude | `https://www.amplitudestatus.com/api/v2/status.json` | `https://www.amplitudestatus.com/api/v2/summary.json` |
| GitHub | `https://www.githubstatus.com/api/v2/status.json` | — |
| npm | `https://status.npmjs.org/api/v2/status.json` | `https://status.npmjs.org/api/v2/summary.json` |
| Cloudflare | `https://www.cloudflarestatus.com/api/v2/status.json` | `https://www.cloudflarestatus.com/api/v2/summary.json` |

**Indicator mapping:**
- `none` = Operational
- `minor` = Degraded
- `major` / `critical` = Down

### Direct Endpoint Health Checks

Both use a 5000ms timeout (`src/lib/health-checks/endpoints.ts`):

| Service | URL | Method |
|---------|-----|--------|
| LLM Gateway | Configured via `ANTHROPIC_BASE_URL` | GET |
| MCP Server | `https://mcp.amplitude.com/` | GET |

---

## Telemetry

The wizard reports its own usage analytics to the main `amplitude/Amplitude` project — the same project the rest of the Amplitude app writes to.

| Setting | Value |
|---------|-------|
| SDK | `@amplitude/analytics-node` |
| Server URL | `https://api2.amplitude.com/2/httpapi` (configurable via `AMPLITUDE_SERVER_URL`) |
| Dev API Key | `ce58b28cace35f7df0eb241b0cd72044` (auto-selected when `NODE_ENV=development` or `test`) |
| Prod API Key | `e5a2c9bdffe949f7da77e6b481e118fa` (default) |
| Override | Set `AMPLITUDE_API_KEY` to override either default |

Both keys mirror Lightning's ampli config (`packages/instrumentation/src/lightning/{agents,wormhole}/src/ampli/index.ts` in `amplitude/javascript`). Local contributor builds invoked via `pnpm try` / `pnpm dev` automatically set `NODE_ENV=development` so they route to the dev project instead of flooding prod. Contributors who `pnpm link --global` and invoke `amplitude-wizard` directly (outside the `pnpm dev` script) need to `export NODE_ENV=development` themselves to hit dev.

**Event namespace:** All events prefixed with `wizard cli: ` (e.g., `wizard cli: Session Ended`, `wizard cli: feedback submitted`, `wizard cli: error encountered`).

**Property-key convention:** All event-property, user-property, and group-identify keys are lowercase with spaces (`'org id'`, `'duration ms'`, `'error message'`). Keys starting with `$` (`$app_name`, `$error`) are Amplitude-reserved and stay untouched.

**Session properties (full):** `integration`, `detected framework`, `typescript`, `project id`, `discovered features`, `additional features`, `run phase`.

**Session properties (compact, for high-volume events):** `integration`, `detected framework`, `run phase`, `project id`.

**Group analytics:** Every event is automatically associated with the `'org id'` group via `setGroup()` inside `identifyUser()`. Do not re-pass `orgId` per event.

**Opt-out:** Controlled by the `FLAG_AGENT_ANALYTICS` feature flag.

### Diagnostic Uploads

On the error outro, the user can press `U` to upload a session-trace bundle
for support triage. The bundle is a gzip-compressed JSON payload containing:

- The last 256 KB of the structured log (`/tmp/amplitude-wizard.logl`)
- The last 50 Sentry breadcrumbs from the in-process buffer
- A redacted snapshot of wizard state (screen, flow, outcome markers)
- Environment metadata (wizard version, Node version, platform, run/attempt/session IDs)

**Endpoint contract:** The uploader POSTs to `${wizardProxyBase}/diagnostics`
(e.g. `https://gateway.us.amplitude.com/wizard/diagnostics`).

| Field | Value |
|-------|-------|
| Method | POST |
| Body | gzip bytes (binary) |
| Content-Type | `application/gzip` |
| Content-Encoding | `gzip` |
| Authorization | `Bearer <access_token>` — optional; unauth uploads are accepted |
| X-Wizard-Diagnostic-Run-Id | Short run id (matches `X-Wizard-Run-Id`) |
| Tracing headers | W3C `traceparent` + `X-Wizard-*` (same as every other request) |

**Expected response (2xx):** `{ "url": string, "id": string }`. The wizard
surfaces the URL in the error outro so the user can share a link.

**Fallback behavior:** If the endpoint returns 404 or 501, or the upload
throws, the client writes the bundle to `/tmp/amplitude-wizard-diagnostic-<runId>.gz`
and surfaces the local path instead. This lets the client ship ahead of the
backend.

**Opt-out:** Honors `DO_NOT_TRACK=1` and `AMPLITUDE_WIZARD_NO_TELEMETRY=1` —
no bundle is built or uploaded when either is set.

**PII:** Bundle content passes through the same `redact()` pass used for
structured logs before gzip. No credentials, tokens, or user-typed strings
should appear in the payload.

---

## Feature Flags

The wizard fetches feature flags from Amplitude Experiment at startup (`initFeatureFlags()` in `bin.ts`).

Used to control:
- Agent analytics opt-out (`FLAG_AGENT_ANALYTICS`)
- LLM analytics SDK detection (`FLAG_LLM_ANALYTICS`)
- Wizard variant selection (`FLAG_WIZARD_VARIANT`)

Flags are refreshed during the session and all active flag values are attached to telemetry events.

---

## Credential Storage

### API Key Storage

Three-tier strategy, tried in order (`src/utils/api-key-store.ts`):

| Tier | Platform | Mechanism | CLI Tool |
|------|----------|-----------|----------|
| 1 | macOS | Keychain Services | `security find-generic-password` / `security add-generic-password` |
| 2 | Linux | GNOME Keyring / KWallet | `secret-tool lookup` / `secret-tool store` |
| 3 | All | `.env.local` in project dir | File I/O (auto-adds to `.gitignore`) |

**Scoping:** Keys are scoped by a SHA-1 hash of the install directory (first 12 hex chars), stored under the service name `amplitude-wizard`.

### OAuth Token Storage

| File | Contents |
|------|----------|
| `~/.ampli.json` | OAuth tokens (ID token, refresh token), user info, zone preference |

This file is shared with the `ampli` CLI — the wizard intentionally uses the same port (`13222`) and storage location for session interoperability.

---

## File System Touchpoints

### Files Read

| Path | Purpose | Source |
|------|---------|--------|
| `~/.ampli.json` | Cached OAuth tokens + zone preference | `src/utils/ampli-settings.ts` |
| `<project>/.env.local` | Fallback API key storage | `src/utils/api-key-store.ts` |
| `<project>/package.json` | Framework detection, dependency scanning | Multiple detectors |
| `<project>/pyproject.toml` | Python project detection | Framework detectors |
| `<project>/requirements.txt` | Python dependency detection | Framework detectors |
| `<project>/.vercel/project.json` | Vercel project linking detection | `src/steps/upload-environment-variables/providers/vercel.ts` |
| `<project>/.amplitude-events.json` | Event plan generated by agent | Agent workflow |

### Files Written

| Path | Purpose | Source |
|------|---------|--------|
| `~/.ampli.json` | Persist OAuth tokens | `src/utils/ampli-settings.ts` |
| `<project>/.env.local` | API key (fallback storage) | `src/utils/api-key-store.ts` |
| `<project>/.gitignore` | Ensure `.env.local` is ignored | `src/utils/api-key-store.ts` |
| `<project>/.amplitude-events.json` | Agent-generated event tracking plan | Agent workflow |

### Editor Config Files Modified (MCP Server Installation)

The wizard writes MCP server configuration to enable Amplitude tools in AI-powered editors (`src/steps/add-mcp-server-to-clients/`):

| Editor | Config Path | Format |
|--------|-------------|--------|
| Cursor | `~/.cursor/mcp.json` | JSON with `mcpServers` key |
| VS Code | `~/.vscode/mcp.json` | JSON with `mcpServers` key |
| Claude Code | `~/.claude/mcp.json` | JSON (or via `claude mcp add` CLI) |
| Zed | `~/.zed/mcp.json` | JSON with `mcpServers` key |

---

## CLI Tools Invoked

The wizard shells out to these external CLI tools at runtime:

### macOS Keychain (`security`)

```bash
# Read
security find-generic-password -a "<hash>" -s "amplitude-wizard" -w
# Write
security add-generic-password -U -a "<hash>" -s "amplitude-wizard" -w "<key>"
# Delete
security delete-generic-password -a "<hash>" -s "amplitude-wizard"
```

### Linux Keyring (`secret-tool`)

```bash
# Read
secret-tool lookup service "amplitude-wizard" account "<hash>"
# Write
printf '%s' "<key>" | secret-tool store --label="Amplitude API Key" service "amplitude-wizard" account "<hash>"
# Delete
secret-tool clear service "amplitude-wizard" account "<hash>"
```

### Claude Code CLI (`claude`)

Search order: `~/.local/bin/claude`, `~/.claude/local/claude`, `/usr/local/bin/claude`, `/opt/homebrew/bin/claude`, then `$PATH`.

```bash
claude --version              # Version check
claude mcp list               # List configured MCP servers
claude mcp add --transport http <name> <url>  # Add MCP server
claude mcp remove --scope user <name>         # Remove MCP server
```

### Vercel CLI (`vercel`)

```bash
vercel --version              # Detect CLI presence
vercel whoami                 # Check authentication (run with CI=1)
vercel env add <key> <env>    # Upload environment variable
```

### npx

```bash
npx -y mcp-remote@latest <url> --header "Authorization: Bearer <token>"
# Used as transport proxy for editors that don't support HTTP MCP natively
```

---

## Environment Variables

### CLI Options (yargs prefix: `AMPLITUDE_WIZARD_`)

| Variable | Flag | Description |
|----------|------|-------------|
| `AMPLITUDE_WIZARD_DEBUG` | `--debug` | Enable debug logging |
| `AMPLITUDE_WIZARD_VERBOSE` | `--verbose` | Verbose output |
| `AMPLITUDE_WIZARD_DEFAULT` | `--default` | Accept all defaults |
| `AMPLITUDE_WIZARD_SIGNUP` | `--signup` | Force sign-up flow |
| `AMPLITUDE_WIZARD_LOCAL_MCP` | `--local-mcp` | Use local MCP server |
| `AMPLITUDE_WIZARD_CI` | `--ci` | CI mode (non-interactive) |
| `AMPLITUDE_WIZARD_API_KEY` | `--api-key` | Pre-set API key |
| `AMPLITUDE_WIZARD_PROJECT_ID` | `--project-id` | Pre-set project ID |
| `AMPLITUDE_WIZARD_FORCE_INSTALL` | `--force-install` | Force reinstallation |
| `AMPLITUDE_WIZARD_INSTALL_DIR` | `--install-dir` | Target directory |
| `AMPLITUDE_WIZARD_INTEGRATION` | `--integration` | Force framework |
| `AMPLITUDE_WIZARD_MENU` | `--menu` | Show framework menu |
| `AMPLITUDE_WIZARD_BENCHMARK` | `--benchmark` | Enable benchmarking |

### Runtime Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `NODE_ENV` | — | `test`/`development` switches URLs to localhost and routes telemetry to the dev Amplitude project |
| `OAUTH_HOST` | Zone-specific | Override OAuth host |
| `OAUTH_CLIENT_ID` | Zone-specific | Override OAuth client ID |
| `AMPLITUDE_API_KEY` | dev: `ce58b28cace35f7df0eb241b0cd72044` / prod: `e5a2c9bdffe949f7da77e6b481e118fa` | Telemetry project API key (auto-selected by `NODE_ENV`) |
| `AMPLITUDE_SERVER_URL` | `https://api2.amplitude.com` | Telemetry server URL |
| `DEMO_MODE_WIZARD` | — | When `1`, limits agent to 5 events for demo runs |
| `CI` | — | Non-interactive mode detection; also set to `1` when invoking Vercel CLI |
| `AMPLITUDE_WIZARD_DISABLE_CACHE` | — | When `1`, disables Claude Agent SDK prompt caching (sets `excludeDynamicSections: false`). Kill switch for the Bet 2 Slice 1 caching change — revert individual runs without reverting the PR. |
| `AMPLITUDE_WIZARD_MAX_TURNS` | `200` | Override the agent's maximum turn count. Useful for eval fixtures (low cap forces short runs) or quick iteration (`AMPLITUDE_WIZARD_MAX_TURNS=30 pnpm try`). Invalid values fall back to the default. |
| `DO_NOT_TRACK` | — | Cross-tool opt-out convention; disables Amplitude telemetry, Sentry, and diagnostic uploads |
| `AMPLITUDE_WIZARD_NO_TELEMETRY` | — | Same behavior as `DO_NOT_TRACK=1` but wizard-specific |

### Framework-Specific SDK Environment Variables

The agent writes these to `.env.local` depending on the detected framework:

| Framework | Variable |
|-----------|----------|
| Next.js | `NEXT_PUBLIC_AMPLITUDE_API_KEY` |
| Vite | `VITE_AMPLITUDE_API_KEY` |
| Create React App | `REACT_APP_AMPLITUDE_API_KEY` |
| Nuxt | `NUXT_PUBLIC_AMPLITUDE_API_KEY` |
| SvelteKit / Astro | `PUBLIC_AMPLITUDE_API_KEY` |
| Server-side (Node, Python, etc.) | `AMPLITUDE_API_KEY` |

---

## Outbound URLs (Browser)

All URLs the wizard opens in the user's browser, defined in `OUTBOUND_URLS` (`src/lib/constants.ts`):

| Purpose | URL Pattern |
|---------|-------------|
| OAuth login | `https://auth[.eu].amplitude.com/oauth2/auth` |
| New chart | `https://app[.eu].amplitude.com/<orgId>/chart/new` |
| New dashboard | `https://app[.eu].amplitude.com/<orgId>/dashboard/new` |
| Slack settings | `https://app[.eu].amplitude.com/analytics/org/<orgId>/settings/profile` |
| Products page | `https://app[.eu].amplitude.com/products?source=wizard` |
| SDK docs | `https://amplitude.com/docs/sdks` + per-framework variants |
| Stripe data source | `https://app.amplitude.com/project/data-warehouse/new-source?kind=Stripe` |
| Claude status | `https://status.claude.com` |
| Amplitude status | `https://www.amplitudestatus.com` |
| Bug reports | `https://github.com/amplitude/wizard/issues` |
