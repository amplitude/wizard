## Bet 3 — The Amplitude AI Gateway

**Branch:** `kelsonpw/ai-gateway`
**Depends on:** Bet 1 (trace propagation). Can overlap with Bet 2.
**Effort:** ~1 quarter.

### Goal

Upgrade the proxy at `core.amplitude.com/wizard` from a Vertex-only shim into a provider-agnostic AI substrate. Flag-driven model routing, multi-provider failover, edge prompt cache, per-org budget protocol, shadow-replay eval harness, client-facing status page. Deployed on GCP.

### Why this matters

Today, moving to Opus 4.7 requires a CLI release. A Vertex regional incident kills every `npx @amplitude/wizard` globally. There's no per-org budget cap — one broken CI loop burns thousands of Vertex tokens silently against Amplitude's account. This is the infrastructure that makes experimentation, cost control, and reliability actually work.

### Deliverables

#### Deployment topology
- [ ] GCP Cloud Run (native SSE passthrough, HTTP/2, scale-to-zero).
- [ ] Primary region `us-central1`; EU region `europe-west1`; latency-based routing via Cloud Load Balancing.
- [ ] EU requests must NOT fail over to US (data residency).

#### Multi-provider failover
- [ ] Primary: Vertex AI. Secondary: AWS Bedrock Claude. Tertiary: Anthropic direct.
- [ ] L7 retry budget + per-provider circuit breakers (open on sustained 5xx; half-open after backoff).
- [ ] Normalize model IDs at the edge so the client stays provider-agnostic.
- [ ] Echo `x-amp-upstream-provider` + `x-amp-resolved-model` on every response.
- [ ] Feature-flag the Bedrock path initially; parity-test prompt-caching semantics before enabling by default.

#### Flag-driven model routing
- [ ] CLI sends `model: "amplitude/wizard-default"` (alias).
- [ ] Proxy resolves via `X-AMPLITUDE-FLAG-*` headers → concrete model.
- [ ] Remove the hardcoded `anthropic/claude-sonnet-4-6` from `src/lib/agent-interface.ts:768-770`.
- [ ] Support weighted canary routing (1% → 10% → 50%) per-flag.
- [ ] Per-framework routing examples: Generic/JavaScript fallback → Haiku; Next.js/Django → Sonnet; opt-in Opus variant.

#### Edge prompt cache
- [ ] Proxy injects `cache_control` at the canonical system-prompt prefix (complements Bet 2's client-side caching).
- [ ] L1: instance-local LRU. L2: Memorystore Redis keyed by `sha256(system + first_user_msg)`.
- [ ] Expose `x-amp-cache: hit|miss` and `x-amp-cache-tokens-saved` on responses.
- [ ] Invalidate on skills-refresh version bump.

#### Budget protocol
- [ ] Per-org token and USD budgets in Memorystore sliding window.
- [ ] Return **402 Payment Required** on exhaustion (not 429) with structured body: `{ reason, remaining_tokens, remaining_usd, reset_at }`.
- [ ] Every successful response echoes `x-amp-tokens-remaining`, `x-amp-budget-usd-remaining`, `x-amp-rate-limit-reset`.
- [ ] Abuse detection: flag orgs with suspicious `maxTurns`-ratio.
- [ ] GCP Billing alerts to Slack on cost spikes.

#### Trace + cost attribution
- [ ] Consume `traceparent` and `X-Wizard-Run-Id` headers from Bet 1. Emit OTel spans to GCP Cloud Trace.
- [ ] Write cost rows to BigQuery keyed by `(org_id, trace_id, model, tokens_in, tokens_out, cache_hit_tokens, provider)`.
- [ ] Mirror client-side redaction from `src/lib/observability/redact.ts` server-side before any trace/log write.

#### Shadow-replay eval harness
- [ ] Replay N% of prod traffic against candidate models/prompts in the background.
- [ ] Score with a Claude-as-judge rubric: does code compile, is `track()` call shape correct, were skills applied, any secrets leaked.
- [ ] Stream scores to BigQuery; dashboard in Looker Studio.
- [ ] PR-triggered offline replay against a frozen corpus of anonymized wizard traffic.

#### Client-facing status page
- [ ] Publish `wizard-status.amplitude.com` — **GitHub Pages** for the static site (org policy permits), or Statuspage.io if that subscription exists.
- [ ] Wire into `src/lib/health-checks/statuspage.ts`.
- [ ] Surface the URL in the exhausted-retry error message so users can self-diagnose.

#### Staged npm rollout
- [ ] Change `.github/workflows/publish.yml:66` and `.github/workflows/release-please.yml:57` to publish `@amplitude/wizard@next` first.
- [ ] Run e2e smoke against the real proxy for 24h.
- [ ] Promote to `@latest` via automated or manual `workflow_dispatch`.
- [ ] Keep prior version pinned as `@stable` for one-command rollback (`npx @amplitude/wizard@stable`).

### Verification

- Synthetic 5-min GitHub Actions canary hits US + EU proxies; `x-amp-upstream-provider` + `x-amp-resolved-model` headers visible.
- Triggered Vertex 5xx fails over to Bedrock within retry budget; client sees no errors.
- Edge cache hit rate ≥50% on the second run of the Bet 1 fixture repos.
- Exceeding a test-org budget returns 402 with structured body; CLI renders the budget-exhausted screen.
- Shadow-replay eval scores visible in BigQuery within 24h of enabling.
- npm `@next` → `@latest` promotion flow produces a clean rollback in <5 minutes.

### Kill criteria

- Multi-provider failover introduces p95 latency regression >100ms on the primary path → route only failover (5xx) through the new router; keep primary on direct Vertex.
- Edge cache hit rate <30% after provider-parity testing → pause the edge cache layer, rely on client-side caching from Bet 2.

### Out of scope

- Billing UI for orgs to view their budget (separate product work, not infra).
- Non-LLM traffic through the gateway (wizard MCP stays on its existing path).
