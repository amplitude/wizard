# Wizard-proxy LLM provider failover — design proposal

**Status:** proposal, awaiting approval. **No code change in this PR — design only.**
**Effective:** 2026-05-07.
**Scope:** server-side (`thunder/wizard-proxy`). Wizard-side changes are minimal (one new error-classification path).

## Problem

A Vertex AI degradation today takes the entire wizard fleet down. There is no failover.

7-day APM data verified earlier this session:

- 73% Vertex 400 rate across both wizard-proxy paths (`models/{model}` and `count-tokens:rawPredict`)
- The wizard's recovery path is "retry up to MAX_RETRIES against the same broken Vertex hop, then surface `GATEWAY_DOWN` and tell the user to set `ANTHROPIC_API_KEY`"
- Users who don't have a personal Anthropic API key are stuck

The migration plan (§6, §9) flags this as the load-bearing missing piece in the LLM client architecture but defers implementation as platform-team work. With #112060 + #113722 (proxy schema/beta hardening) and #589 + #113749 (wizard-side error-handling improvements) in flight, this is the next concrete step.

## Goals

1. **Vertex 5xx → automatic fallback to Anthropic-direct** for the same request, no client-side retry needed. Single retry, server-side.
2. **Bounded blast radius.** Behind a feature flag, gradual rollout, instant kill switch via dynconf or env var.
3. **Observability that distinguishes "Vertex unhealthy" from "client payload bad" from "Anthropic-direct also failed."**
4. **No new wizard-side failure modes.** The wizard sees one structured response: success, or the same `GATEWAY_DOWN` it sees today (with a richer error envelope describing both upstream attempts).

## Non-goals

- Failover on Vertex 4xx. Payload-shape rejections are deterministic — Anthropic-direct will not save us. Already mitigated by #113722's schema strip.
- Bedrock as a third leg. Requires AWS credential plumbing, region selection, model name re-mapping, and additional integration testing. Defer to a follow-up; Anthropic-direct is the fast win because the contract is the same.
- Active/active load balancing. We're solving "Vertex is unhealthy," not "we want to spread traffic for cost or latency."
- Failover on count-tokens. The preflight is best-effort; if it 5xxs we should let the model call proceed without it (this is its own follow-up, separate from this PR).

## Proposal

### High-level shape

```
   wizard CLI
      │
      ▼
  wizard-proxy /wizard/v1/messages
      │
      ▼
   Try Vertex AI ──► 200 ► return to client
      │ 5xx (or DEADLINE_EXCEEDED, or fetch error)
      ▼
   FALLBACK ENABLED?
      │ no  → return upstream-error envelope (today's behavior)
      │ yes
      ▼
   Try Anthropic direct ──► 200 ► return to client + emit fallback metric
      │ 5xx
      ▼
   Return GATEWAY_DOWN with both upstream statuses in the error envelope
```

### Decision: provider order

| Provider | Status | Rationale |
|---|---|---|
| Vertex AI (primary) | shipped | Existing GCP infra, OAuth-mapped service account, Anthropic publisher endpoint |
| **Anthropic direct (fallback)** | proposed in this doc | Same contract as the wizard sends, no schema-key issues, no beta-allowlist issues, fastest to implement |
| AWS Bedrock | future | Requires AWS auth, model remapping, region selection. Defer until Anthropic-direct + Vertex aren't enough |

### Decision: trigger criteria

Failover fires only when **all** of the following hold:

1. The Vertex `fetch` returned a 5xx status, OR threw a fetch-level error (DNS, connect timeout, ECONNRESET, AbortError after `VERTEX_FETCH_TIMEOUT_MS`).
2. The request did not return any streamed chunks. A mid-stream Vertex failure cannot be retried server-side without re-doing the model call from scratch — the cost and latency penalty is too high. We surface a normal stream-error envelope to the client and let the wizard's existing retry handle it.
3. The feature flag is on (per-environment dynconf or env var).
4. The request is not a count-tokens preflight (count-tokens has its own simpler failure model).

Vertex 4xx is **explicitly not** a trigger — those are payload-shape rejections that Anthropic-direct would also reject. The schema strip in #113722 + the beta filter in #112060 are the right fix for that class.

### Decision: secrets + auth

Anthropic-direct requires an API key. Options:

| Option | Pros | Cons |
|---|---|---|
| (A) Single shared `WIZARD_PROXY_ANTHROPIC_DIRECT_KEY` in AWS Secrets Manager | Simplest. Same auth surface as Vertex SA today. | All wizard fallback traffic shares one rate-limit budget. Anthropic-direct's per-key TPM limit is the cap. |
| (B) Per-org keys provisioned by orgs | Scales rate limits | Requires org admin UI, key rotation, org-side support. Big project. |
| (C) Per-user OAuth via Anthropic's enterprise SSO | Best long-term | Anthropic doesn't offer this for the Claude Console API today. |

**Recommend (A) for v1.** The fallback is for "Vertex unhealthy," which is rare; the shared-key TPM cap is acceptable for the recovery window. Revisit when Bedrock lands or when we see fallback traffic exceed 10% of total.

Rotation: 90-day cycle, dual-key support during rotation (the secret schema can hold `current` + `previous` and the proxy tries `current` first, falls back to `previous` on 401). Rotation runbook lives next to the secret in 1Password.

### Decision: feature flag

`WIZARD_PROXY_ANTHROPIC_FALLBACK` env var with three values:

- `disabled` (default for the rollout window) — no fallback, today's behavior
- `staff_only` — fallback fires only when `ctx.state.wizardUser.email` ends in `@amplitude.com`
- `enabled` — fallback fires for all users

Override via dynconf so we can flip without a deploy. Kill-switch: set the env var to `disabled` in the running pod and bounce; or flip the dynconf flag for an instant rollback.

### Decision: error envelope on dual failure

When both Vertex AND Anthropic-direct fail, the proxy returns:

```json
{
  "type": "error",
  "error": {
    "type": "api_error",
    "message": "<the more diagnostic of the two upstream messages>",
    "upstream": {
      "vertex": { "status": 503, "message": "<vertex msg>" },
      "anthropic_direct": { "status": 500, "message": "<anthropic msg>" }
    }
  }
}
```

The wizard's existing structured-error parser (#589 `parseStructuredUpstreamError`) handles this shape — it reads `upstream` as an opaque value, so the new shape is backward-compatible. The wizard could optionally branch on `upstream.vertex` vs `upstream.anthropic_direct` to surface a richer remediation message ("both providers failed — service is degraded"), but isn't required to.

### Decision: telemetry surface

New metrics:

| Metric | Tags | Purpose |
|---|---|---|
| `thunder.wizard_proxy.fallback.attempted` | `reason:vertex_5xx|vertex_fetch_error|vertex_timeout` | How often we even try the fallback |
| `thunder.wizard_proxy.fallback.success` | `reason:<same>` | Did the fallback save the request |
| `thunder.wizard_proxy.fallback.failed` | `reason:<same>`, `direct_status:<code>` | Did Anthropic-direct also fail |
| `thunder.wizard_proxy.fallback.latency_ms` | `outcome:success|failed` | Distribution of fallback latency |

New structured log fields on the existing `request completed` line (from #113749): `fallback_attempted`, `fallback_outcome`, `vertex_status`, `direct_status`.

Datadog monitor: alert when `fallback.attempted` rate exceeds 5% of total requests for 10 minutes — this is the "Vertex is degraded" signal that orchestrates incident response.

### Decision: latency budget

Anthropic-direct typical p50 ~1.5s for a streaming first-token call. Adding it as a sequential second attempt on Vertex 5xx adds:

- Vertex timeout / 5xx detection: bounded by `VERTEX_FETCH_TIMEOUT_MS` (currently 20 minutes — way too generous for failover purposes)
- Anthropic-direct attempt: ~1.5s p50, up to its own 30s timeout

For failover to be useful, **the Vertex timeout has to be tighter on the failover path.** Proposal: introduce `VERTEX_FAILOVER_TIMEOUT_MS = 15_000` for the initial-burst portion of the request. If Vertex hasn't started streaming chunks within 15s on a request that would otherwise trigger a fallback, abort and fail over. Existing `VERTEX_FETCH_TIMEOUT_MS = 1_200_000` stays for already-streaming requests.

## Implementation slicing

Three independently shippable PRs:

1. **Pure helpers** (this design + tests): `buildAnthropicDirectFetch`, `shouldFailover(vertexResult)`, error-envelope merging. Pure functions, no I/O. Unit-testable.
2. **Wire-in behind `staff_only` flag**: actual fallback path in the messages handler, secrets manager integration, metrics emission. Limited to amplitude.com users for the first ~7 days.
3. **Promote to `enabled` + monitor**: flip the flag, watch the dashboard, kill-switch ready.

Each PR is <400 LOC, independently revertable. The first ships entirely-new code with no behavior change at all.

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Anthropic-direct API key leaks to client logs | The same redaction surface as the Vertex access token (`stripSensitiveFields` in `buildUpstreamErrorBody` — already strips `Authorization`, `x-api-key`, `x-goog-*`). Add `x-anthropic-key` to the regex. |
| Anthropic-direct hits its own rate limit and we cascade | Track `direct_status:429` count separately; alert when it exceeds 0.1% of fallback attempts. Ratchet to (B) per-org keys when this fires sustainedly. |
| The fallback hides Vertex degradations from the platform team | Dashboard alert on `fallback.attempted` rate (see §telemetry above). Vertex outages get visible faster, not slower. |
| Cost — Anthropic-direct is more expensive per token than Vertex | True for the duration of the fallback. The cost of NOT failing over (failed user runs, support load) dwarfs the marginal model cost during a Vertex outage. Accepted. |
| Wizard-side double-retry: wizard retries on `GATEWAY_DOWN`, proxy now retries on Vertex 5xx | The wizard's retry budget is per-attempt (one `query()` call). The proxy's failover is one extra upstream hop within that single attempt. They compose: a single wizard attempt may try `Vertex → Anthropic-direct`, then if both fail the wizard retries and tries `Vertex → Anthropic-direct` again. This is the right behavior — covers Vertex transient + Anthropic-direct transient. |
| Anthropic API contract drift between Vertex and direct | The wizard already targets the Anthropic API contract; Vertex wraps it with `anthropic_version` + URL-encoded model. The proxy's `buildVertexBody` adds those; reversing them for direct-Anthropic is mechanical. The bigger concern is `anthropic-beta` headers (see #112060) — these typically work on direct AND on Vertex if Vertex supports them. Direct-Anthropic supports the superset, so no incremental risk. |

## What this PR is NOT

- Not implementation. **Just the design.** Approve the design here; implementation lands as PRs A/B/C above.
- Not a substitute for the schema/beta hardening. Those PRs (#112060 / #113722) handle 4xx; this proposal handles 5xx. Independent and complementary.
- Not Bedrock. Future work.

## Approval needed from

- Platform team (thunder owners): confirm `WIZARD_PROXY_ANTHROPIC_DIRECT_KEY` secret rotation cadence is consistent with their existing patterns
- Security: review the `staff_only` gating and the `x-anthropic-key` redaction add
- LLM cost owner: sign off on the Anthropic-direct fallback budget impact

## References

- `MIGRATION_PLAN.md` §6, §9 — original failover ask
- `amplitude/javascript#112060` — beta filter (merged)
- `amplitude/javascript#113722` — schema-key strip (open)
- `amplitude/wizard#589` — wizard-side structured error parsing (open)
- `amplitude/javascript#113749` — proxy session-id echo + structured log (open)
