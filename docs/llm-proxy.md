# LLM Proxy Architecture

The wizard uses a proxy service to route Claude Agent SDK requests through GCP Vertex AI, avoiding a direct Anthropic dependency.

## How it works

```
wizard CLI  ─>  Amplitude LLM Proxy  ─>  GCP Vertex AI  ─>  Claude
              core.amplitude.com/wizard     rawPredict
```

1. User runs `pnpm try login` to authenticate via Amplitude OAuth (PKCE)
2. The wizard stores the OAuth access token in `~/.ampli.json`
3. When the wizard starts the Claude agent, it sets:
   - `ANTHROPIC_BASE_URL` → the proxy URL (e.g. `core.amplitude.com/wizard`)
   - `ANTHROPIC_AUTH_TOKEN` → the user's OAuth access token
4. The Claude Agent SDK spawns a `claude` CLI subprocess with these env vars
5. The CLI sends requests to `{ANTHROPIC_BASE_URL}/v1/messages` with the token as `Authorization: Bearer`
6. The proxy validates the token via OAuth introspection
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

### Quick start

```bash
# Terminal 1: Start the proxy with auth bypass
pnpm proxy:bypass

# Terminal 2: Run the wizard
pnpm try
```

### With real OAuth auth

```bash
# Login first
pnpm try login

# Terminal 1: Start the proxy (validates tokens via Hydra)
pnpm proxy

# Terminal 2: Run the proxy validation suite
pnpm test:proxy

# Terminal 3: Run the wizard
pnpm try
```

### Validating the proxy

```bash
# Runs health, models, non-streaming, streaming, and SDK integration tests
# Uses the stored OAuth token from `pnpm try login` automatically
pnpm test:proxy
```

## Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `WIZARD_LLM_PROXY_URL` | Override the proxy URL entirely | (auto-detected from host) |
| `WIZARD_PROXY_DEV_BYPASS` | Set to `1` on the proxy to skip auth validation (local only) | - |
| `ANTHROPIC_API_KEY` | Bypass the proxy entirely and use Anthropic API directly | - |

## Auth flow

The proxy accepts the OAuth access token in two ways (checked in order):
1. `x-api-key` header (Anthropic SDK standard)
2. `Authorization: Bearer` header (Claude CLI standard)

The token is validated via OAuth introspection. When `WIZARD_PROXY_DEV_BYPASS=1` is set on the proxy, auth is skipped.

## Rate limiting

Per-user limits enforced via Redis:
- 60 requests per minute (sliding window)
- 5 concurrent in-flight requests
- 1,000,000 tokens per day (input + output combined)

## Wizard-side code

| Component | Location |
|-----------|----------|
| Proxy URL logic | `src/utils/urls.ts` |
| SDK setup | `src/lib/agent-interface.ts` |
| Integration tests | `scripts/test-proxy.ts` |
