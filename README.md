# Amplitude Wizard

An interactive CLI that guides developers through instrumenting their app with
Amplitude analytics. It detects your framework, authenticates with your
Amplitude account, runs a Claude-powered agent to set up the SDK and events, and
walks you through your first chart and dashboard.

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

## Usage

```bash
npx @amplitude/wizard
```

### CI mode

```bash
npx @amplitude/wizard --ci --org <org> --project <project> --api-key <key> --install-dir <dir>
```

### Slash commands

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
| `/help`      | List available slash commands                                     |

## Development

```bash
pnpm install
pnpm build
pnpm try
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

Override the javascript repo location: `JS_REPO=/path/to/javascript pnpm proxy`

Validate the proxy is working: `pnpm test:proxy`

### Render flow diagrams

```bash
pnpm flows
```

Renders all diagrams from `docs/flows.md` to PNGs in `docs/diagrams/`.
