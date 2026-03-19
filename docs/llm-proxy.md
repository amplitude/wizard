# LLM Proxy Architecture

The wizard uses a proxy service to route Claude Agent SDK requests through GCP Vertex AI, avoiding a direct Anthropic dependency.

## How it works

```
wizard CLI  ─>  Thunder (wizard-proxy-router)  ─>  GCP Vertex AI  ─>  Claude
              core.amplitude.com/wizard              rawPredict
```

1. User runs `pnpm try login` to authenticate via Amplitude OAuth (PKCE)
2. The wizard stores the OAuth access token in `~/.ampli.json`
3. When the wizard starts the Claude agent, it sets:
   - `ANTHROPIC_BASE_URL` → the proxy URL (e.g. `core.amplitude.com/wizard`)
   - `ANTHROPIC_AUTH_TOKEN` → the user's OAuth access token
4. The Claude Agent SDK spawns a `claude` CLI subprocess with these env vars
5. The CLI sends requests to `{ANTHROPIC_BASE_URL}/v1/messages` with the token as `Authorization: Bearer`
6. The proxy validates the token via Hydra OAuth introspection
7. The proxy forwards the request to Vertex AI `rawPredict` / `streamRawPredict`

## Proxy endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/wizard/health` | Health check (no auth) |
| GET | `/wizard/v1/models` | Model list for SDK discovery (no auth) |
| POST | `/wizard/v1/messages` | Proxy to Vertex AI (auth + rate limit) |

## Production URLs

| Region | URL |
|--------|-----|
| US | `https://core.amplitude.com/wizard` |
| EU | `https://core.eu.amplitude.com/wizard` |

## Local development

### Option 1: Standalone proxy (fastest iteration)

```bash
# Terminal 1: Start the proxy (needs GCP credentials via aws-vault)
# With auth bypass (no login needed):
cd javascript
WIZARD_PROXY_DEV_BYPASS=1 aws-vault exec us-prod-engineer -- \
  npx tsx server/packages/thunder/src/wizard-proxy-standalone.ts

# Or without bypass (test real OAuth token flow — requires `pnpm try login` first):
cd javascript
aws-vault exec us-prod-engineer -- \
  npx tsx server/packages/thunder/src/wizard-proxy-standalone.ts

# Terminal 2: Run the wizard
cd wizard
pnpm try
```

### Option 2: Full Thunder server

```bash
# Terminal 1: Start Thunder
cd javascript
ENVIRONMENT=local aws-vault exec us-prod-engineer -- \
  pnpm --filter thunder start

# Terminal 2: Run the wizard
cd wizard
pnpm try
```

### Option 3: Use the `proxy` npm script

```bash
# Starts the standalone proxy, pointing at ../javascript by default
pnpm proxy

# Override the javascript repo location
JS_REPO=~/repos/javascript pnpm proxy
```

### Validating the proxy

```bash
# Runs health, models, non-streaming, streaming, and SDK integration tests
pnpm test:proxy
```

## Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `WIZARD_LLM_PROXY_URL` | Override the proxy URL entirely | (auto-detected from host) |
| `WIZARD_PROXY_DEV_TOKEN` | Use this token instead of OAuth (for local dev) | - |
| `ANTHROPIC_API_KEY` | Bypass the proxy entirely and use Anthropic API directly | - |
| `JS_REPO` | Path to the javascript repo (for `pnpm proxy` script) | `../javascript` |

## Auth flow

The proxy accepts the OAuth access token in two ways (checked in order):
1. `x-api-key` header (Anthropic SDK standard)
2. `Authorization: Bearer` header (Claude CLI standard)

The token is validated via Hydra OAuth introspection. In `ENVIRONMENT=local`, auth is auto-bypassed.

## Rate limiting

Per-user limits enforced via Redis (`redisThunderTransient`):
- 60 requests per minute (sliding window)
- 5 concurrent in-flight requests
- 1,000,000 tokens per day (input + output combined)

## Code locations

| Component | Location |
|-----------|----------|
| Proxy router | `javascript/server/packages/thunder/src/wizard-proxy/router.ts` |
| Auth (Hydra) | `javascript/server/packages/thunder/src/wizard-proxy/auth.ts` |
| Rate limiter | `javascript/server/packages/thunder/src/wizard-proxy/rate-limiter.ts` |
| Vertex AI | `javascript/server/packages/thunder/src/wizard-proxy/vertex.ts` |
| Unit tests | `javascript/server/packages/thunder/src/wizard-proxy/router.test.ts` |
| Proxy URL logic | `wizard/src/utils/urls.ts` |
| SDK setup | `wizard/src/lib/agent-interface.ts` |
| Integration tests | `wizard/scripts/test-proxy.ts` |
| Jira | AMP-150672 |
