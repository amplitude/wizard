# Wizard Migration Plan

Author: senior engineering lead, prepared for the wizard team
Date: 2026-05-04
Source repos audited: `~/worktree-repos/{wizard, wizard-v2, wizard-rewrite, context-hub}`, `~/amplitude-repos/javascript/server/packages/app-api/src/wizard-proxy`
Repos referenced in the brief but not present locally: `marketplace-internal`, `mcp-marketplace`, `builder-skills`. Sections that depend on those are marked **[unverified — repo not local]**.

This plan was reviewed by three independent senior reviewers (code correctness, PM/scope, architectural fit). Their findings have been integrated. Notable changes from the first draft: **LangGraph is dropped**, ambient-agent support **ships before** TUI rebuild, the foundation strategy is now **"wizard-v2 harness onto wizard-rewrite's presentation seam, no LangGraph"**, and Vercel AI Gateway + prompt caching are added as Phase 1+ items.

---

## 1. Executive Summary

The shipped wizard is a forked-PostHog codebase carrying ~50,000 LOC of TypeScript, of which `src/lib/agent-interface.ts` alone is 4,112 LOC and contains a single 1,569-LOC `runAgent` function. It has hand-rolled stream-noise filtering, two MCP server stacks, three LLM client paths, dual-write Ampli compatibility shims, and ~225 LOC of can-use-tool policy mixed into the same file as the gateway client. It still works, but a critical class of users — anyone running it inside an ambient agent like Claude Code — cannot use `--agent` mode at all because `betas: ['context-1m-2025-08-07']` (`agent-interface.ts:2969`) is being rejected by Vertex AI on the proxy path.

Two clean rewrites already exist. **wizard-v2** is operationally complete and already runs taxonomy + instrumentation agents through Vercel AI SDK v6 with a working schema-and-beta-header sanitizer for the Vertex backend. **wizard-rewrite** is architecturally cleaner — it has the explicit `WizardInstallPresentation` interface seam designed for an Ink TUI, but its agent loop is currently broken against the live proxy (no sanitizer) and it depends on LangGraph as a second runtime alongside Vercel AI SDK.

**Verdict (one sentence):** Build a single new foundation that takes **wizard-v2's working harness, sanitizer, skills, tools, evals, and templates** and lifts them onto **wizard-rewrite's `WizardInstallPresentation` interface (the only piece worth taking from wizard-rewrite)** — and **drop LangGraph entirely**, folding install-graph state into Vercel AI SDK's tool-loop primitives so the team runs one runtime, not two.

The destination is: a single ESM-only npm package, Vercel AI SDK v6 (`@ai-sdk/anthropic` 3.x) as the **only** agent runtime, Vercel AI Gateway for multi-provider failover, prompt caching on the commandments + skills prefix, an Ink-based TUI plugged into `WizardInstallPresentation`, ambient-agent mode that registers the wizard as an MCP server inside parent harnesses, MCP-native context delivery, skills pinned to a versioned `context-hub` release, and structured output for non-interactive contexts.

---

## 2. Critical Bug Analysis — `--agent` API 400 in hosted agent environments

### Symptom
```
API Error: 400 {"type":"error","error":{"type":"api_error","message":"Invalid request sent to model provider"}}
```
Persistent and unrecoverable when `npx @amplitude/wizard --agent` runs inside Claude Code (VS Code), Cursor, or Cline.

### Hypothesis under test
The wizard's agent harness fights the host agent's auth context — two harnesses sharing an API key, env var, or request shape.

### Verdict on the hypothesis
**Mostly disproved.** The auth-conflict hypothesis is already heavily mitigated:

- `bin.ts:9-10` runs env sanitization at the **first line of execution**, stripping `CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_AGENT_SDK_*`, `DEBUG_CLAUDE_AGENT_SDK` before any other import (`src/lib/sanitize-claude-env.ts:21-58`).
- `initializeAgent` re-runs sanitization (`agent-interface.ts:1902`), deletes `ANTHROPIC_AUTH_TOKEN` whenever a direct API key path is taken (line 1920) or local-claude is used (line 1925), and writes the wizard-managed env into a *local* `.claude/settings.local.json` so it beats any user-checked-in `.claude/settings.json` (`claude-settings-scope.ts:68-73`).
- Tests exist: `src/lib/__tests__/sanitize-claude-env.test.ts`, `detect-nested-agent.test.ts`.

### Where the 400 actually originates
Confirmed by reading the wizard-proxy implementation in the App API (`~/amplitude-repos/javascript/server/packages/app-api/src/wizard-proxy/`):

- **The wizard-proxy does no body validation and no schema scrubbing.** `router.ts:677-1224` resolves model against `MODEL_MAPPING`, validates `max_tokens`, runs a rough 1M-token pre-flight, then passes the body verbatim to Vertex via `buildVertexBody` (`vertex.ts:260-271`).
- **The `anthropic-beta` header is passed through verbatim** (`router.ts:443-451`) for any value matching `/^[a-zA-Z0-9\-, ]+$/` — `context-1m-2025-08-07` matches.
- **No code in `wizard-proxy/` touches `$schema`, `additionalProperties`, `exclusiveMinimum`, or any `tools[].input_schema` field.** Grep returns zero hits.
- **The literal `"Invalid request sent to model provider"` string is wrapped by the proxy** at `router.ts:917-974` as a generic "upstream returned 4xx" wrapper. The actual upstream rejection is **Vertex AI's Anthropic publisher endpoint**. The App API logs the real Vertex body server-side at `router.ts:927` via `winston.warn(LOG_PREFIX + ' Upstream error', { status, body: errText.substring(0, 500), ... })` (`LOG_PREFIX = '[WizardProxy]'`) — visible in Datadog if you have access — but the wizard never sees it.

So the 400 is: **Vertex AI rejects → the App API logs the real reason → the App API returns the generic wrapper to the wizard**.

### Actual root cause (ranked)

**1. Highest-priority: `betas: ['context-1m-2025-08-07']` is rejected by Vertex AI.**
At `agent-interface.ts:2969` the agent harness unconditionally opts into the 1M-context beta on the gateway path. The comment claims this is "safe to leave on — falls back to 200K if the backing model doesn't support it" — wrong on Vertex. Vertex AI's Anthropic publisher endpoint does not enable arbitrary `anthropic-beta` previews, returns 400 INVALID_ARGUMENT, and the App API wraps as the generic message. **Confirmation step before shipping:** check the App API's `[WizardProxy] Upstream error` logs for a recent failing request to confirm the real Vertex rejection — the cause may be the beta, the schema noise (#3), or both.

**2. Reinforces #1.** `agent-interface.ts:1950` sets `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=true` in the SDK's child env, but `agent-interface.ts:2969` then *explicitly opts back into* a beta via the SDK's `betas` option, overriding the env disable.

**3. Same class of bug — tool-input-schema noise.** Vertex AI's Anthropic-on-Vertex deployment is stricter than direct Anthropic and rejects `tools[i].input_schema` carrying `$schema`, `additionalProperties`, or `exclusiveMinimum`/`exclusiveMaximum`. zod-to-json-schema emits all of these. wizard-v2 strips `$schema` and `additionalProperties` (`wizard-v2/src/llm/client.ts:41-53, 65-76`); **the shipped wizard does not strip any of them**, and even wizard-v2 is missing `exclusiveMinimum`/`exclusiveMaximum`. The Phase 1 sanitizer must add those four keys, not just port two of them.

**4. Possibly contributing — model id.** `agent-interface.ts:2944-2948` uses `claude-sonnet-4-5-20250514` (gateway path: `'anthropic/claude-sonnet-4-5-20250514'`, direct path: `'claude-sonnet-4-5-20250514'`). Pin to `claude-sonnet-4-6` to match wizard-v2's known-working version (`wizard-v2/src/llm/client.ts:34`).

**5. Long-tail — `ANTHROPIC_CUSTOM_HEADERS` malformed.** `buildAgentEnv` (`agent-interface.ts:1313-1342`) joins headers with `\n` via `createCustomHeaders().encode()`. If session metadata contains a newline or colon, the SDK hands the gateway garbage headers. Cheap to harden.

### Auth pattern decision (must pin in Phase 1)
wizard-v2 (`client.ts:104-112`) uses `apiKey: 'unused-bearer-auth'` + manually injected `Authorization: Bearer <token>` header. wizard-rewrite (`wizard-anthropic-provider.ts:36-42`) uses `createAnthropic({ baseURL, authToken })` — `@ai-sdk/anthropic`'s built-in OAuth bearer mode. These are not drop-in compatible. **Decision: use `authToken` (wizard-rewrite's pattern)**. It's simpler, has fewer moving parts, and is what `@ai-sdk/anthropic` 3.x officially supports. Validate end-to-end against the App API's `authenticate` middleware in Phase 1.

### What needs to change to fix it (Phase 1 scope)

1. Delete or env-gate `betas: ['context-1m-2025-08-07']` at `agent-interface.ts:2969`. Default off; opt back in with `AMPLITUDE_WIZARD_GATEWAY_BETAS=1`. Drop the misleading "falls back to 200K" comment.
2. Add a sanitizing fetch wrapper that strips `anthropic-beta` headers and `$schema`/`additionalProperties`/`exclusiveMinimum`/`exclusiveMaximum` from `tools[].input_schema`. Port wizard-v2's `sanitizingFetch` and **add the two missing exclusive keys** — these are net-new code, not a port.
3. Update `fallbackModel` to `claude-sonnet-4-6`.
4. Tighten the 400 retry classifier (`agent-interface.ts:3492-3552`) to detect `"Invalid request sent to model provider"` and emit `gateway_400_invalid_request` with a clear remediation message ("your wizard build is requesting a beta or schema field the gateway rejects; please update").
5. Add a regression test that asserts the wire request body never contains `$schema`, `additionalProperties`, `exclusiveMinimum`, `exclusiveMaximum`, or `anthropic-beta` headers in a `--agent` run.
6. Workaround for users today (do not ship; communicate): `ANTHROPIC_API_KEY=sk-ant-… npx @amplitude/wizard --agent` skips the gateway entirely (`agent-interface.ts:1913-1921`).

---

## 3. Competitive & Industry Findings (May 2026)

### Vercel AI SDK is now the harness consensus

- AI SDK 6 introduced `ToolLoopAgent` — production-grade reusable agent encapsulating `instructions`, `tools`, `model`, `stopWhen`. Default `stopWhen` moved to `stepCountIs(20)`.
- `prepareStep` is the canonical seam for per-step mutation — context compression, model swapping, system-prompt edits.
- `experimental_createMCPClient` over `stdio` is stable in practice.
- Typed errors (`APICallError.isInstance(e)`, `RetryError`, `NoSuchToolError`, `InvalidToolArgumentsError`) replace hand-rolled regex retry classifiers.
- Per-tool strict mode is opt-in in v6.
- Known traps: `@ai-sdk/anthropic@2.0.45` overwrote user-supplied `anthropic-beta` headers (fixed in 2.0.49 — pin past it). `streamText` errors sometimes surface as a chunk variant rather than thrown exceptions. Zod `.min()/.max()` on numbers emits `exclusiveMinimum`/`exclusiveMaximum` which Vertex rejects (issue vercel/ai #14342).
- AI SDK retries internally with `maxRetries: 2`. Don't double-retry.

### Things wizard should adopt that the first plan draft missed

- **Vercel AI Gateway** for multi-provider failover (Anthropic direct → Bedrock on AWS → Vertex on GCP). Given that the trigger event for this whole migration is a Vertex 400, multi-provider failover is a Phase 1+ item, not a future consideration.
- **Prompt caching** via `@ai-sdk/anthropic` 3.x cache control. Wizard's commandments + active skills are 5K+ tokens of cache-stable prefix. This is free latency reduction and ~90% input-token cost reduction on the cached prefix.
- **MCP server mode for ambient agents.** When wizard detects it's running inside Claude Code, Cursor, or Cline, it should register itself as an MCP server (typed tools: `detect_framework`, `propose_event_plan`, `apply_instrumentation`, `verify_ingestion`) and let the parent agent drive. This eliminates the harness-vs-harness fight by construction. The wizard already has `wizard-mcp-server.ts` (read-only MCP) and `--plan-only` returning `proposedTrackingPlan` — both rewrites have the building blocks.

### Industry has converged on a small set of patterns

- **Skills format** (Anthropic's agentskills.io spec) was adopted by 32 tools within ~3 months. Three-tier progressive disclosure (name+description always loaded ~100 tokens/skill, body on activation <5K, references lazy).
- **MCP everywhere.** Donated to the Linux Foundation's Agentic AI Foundation in Dec 2025. Co-locating *small* low-permission MCP servers (filesystem, project search) with a CLI is now standard; auth-bearing services stay external.
- **AGENTS.md / CLAUDE.md / WIZARD.md** convention — single project-root markdown context file. Wizard does not have this yet.
- **Ambient-agent detection** is now table stakes. The `AI_AGENT` env var convention (Vercel-promoted) plus `CLAUDECODE`, `CURSOR_AGENT`/`CURSOR_CLI`, `CODEX_CI`, `COPILOT_GITHUB_TOKEN`. `@vercel/detect-agent` is a usable reference.
- **Multi-level timeouts** (per-tool / per-task / per-sandbox) are standard.
- **Structured `--json` modes** as versioned API contracts. AWS CLI v2.34+ has `--cli-error-format` for this.
- **OpenTelemetry GenAI semantic conventions** — content stored as span events (drop-able at the Collector). Default redacted, opt-in via `OTEL_LOG_USER_PROMPTS=1`.
- **MCP Apps (SEP-1865)** is becoming the standard for interactive agent responses. Worth adopting in a later phase to replace the bespoke `confirm` / `confirm_event_plan` tools.

### Where wizard is behind
- Doesn't strip `anthropic-beta`, `$schema`, `additionalProperties`, `exclusiveMinimum`/`exclusiveMaximum`. The bug.
- Three LLM client paths (Agent SDK + Agent SDK local-cli spawn + `console-query.ts`).
- 200-LOC `createPreToolUseHook` + 225-LOC `wizardCanUseTool`.
- No first-class ambient-agent detection or MCP-server-mode routing.
- No prompt caching despite stable 5K+ token system prefix.
- No multi-provider failover.
- Ships `latest` skills tag from context-hub instead of pinning a release version.

### Where wizard could lead
- **Schema-strict tool definitions surviving Vertex strict validation by default.** No major peer ships this.
- **Ambient mode as MCP-server-mode.** First-class rather than retro-fit. No peer does this well — Cursor's CLI fails inside Cursor's own integrated terminal because of TTY/env conflicts.
- **First-class skills + version-pinned distribution** colocated with a clear two-cadence release model.

---

## 4. Internal Codebase Findings

### Shipped wizard (`~/worktree-repos/wizard`)

**The single biggest problem is `src/lib/agent-interface.ts` (4,112 LOC).** It mixes:
- SDK loading + dynamic-import type mirrors (lines 97-162).
- Model selection + max-turns + auth detection (lines 218-263, 1889-2053).
- 200-LOC `createPreToolUseHook` (669-871) and four other hook factories (888-1221).
- Stream event filtering (`stripStreamEventNoise`, 544-630) — hand-rolled because `includePartialMessages: true` leaks SDK envelopes into stderr.
- 250-LOC bash policy with allowlist+deny+circuit-breaker (1339-1591).
- 225-LOC `wizardCanUseTool` env-file/path policy (1659-1885).
- A 1,569-LOC `runAgent` function (2301-3870).
- Two LLM client paths (`runAgentLocally` 2119-2236 and `console-query.ts`).

**Other concentrations of complexity:**
- `src/lib/wizard-tools.ts` (1,964 LOC) — single file, 9 tools defined inline.
- `src/lib/agent-runner.ts` (1,835 LOC) — universal runner.
- `src/lib/wizard-session.ts` (1,091 LOC) — load-bearing mutable state.
- `src/ui/tui/store.ts` (2,071 LOC), `screens/DataIngestionCheckScreen.tsx` (1,142 LOC), `AuthScreen.tsx` (965 LOC).
- `src/lib/api.ts` (1,260 LOC), `src/lib/credential-resolution.ts` (663 LOC), `src/commands/default.ts` (1,361 LOC).

**PostHog / Ampli inheritance traces:**
- Forked from `posthog/wizard` (commits `59f5e944`, `d29fc578`, `9047bdd0`, `f9966004`, `6b784cc4`, `5867c81c`, `71158b6e` rebrand). String scrub thorough; the *shape* is the residue.
- Ampli legacy: `src/utils/ampli-settings.ts` (474 LOC) reads/writes OAuth tokens to `~/.ampli.json`; `src/lib/ampli-config.ts` (371 LOC) reads/writes `ampli.json` and migrates `WorkspaceId` → `ProjectId`. 30+ TUI files reference `ampli.json` paths. Pure compatibility tax.
- Dead deps: `zod-to-json-schema` (declared, never imported), `xcode`, pinned `chalk@2.4.2`.
- Two MCP server stacks: `@anthropic-ai/claude-agent-sdk` plus `@modelcontextprotocol/sdk`.
- Mirror types of the SDK at `agent-interface.ts:97-148`, `agent-hooks.ts:5-29`, `middleware/schemas.ts:87+` — duplicated only because of CJS dynamic-import interop.
- Build is bare `tsc` to CJS; no `exports` map.

**TUI architecture is genuinely good and should be carried forward, not rewritten.** Ink + React 19 + nanostores + `@inkjs/ui`. `flows.ts` declarative pipelines + `router.ts` overlay stack + `screen-registry.tsx`. 17 screens, 14 components. Fast-check property-based flow invariant tests are an asset. Coupling is `WizardSession`, not the TUI itself. **Lift, don't rebuild.**

### wizard-v2 (`~/worktree-repos/wizard-v2`)

~12,638 LOC TS. ESM. Clean `LlmClient` (`src/llm/client.ts:80-175`) with **the working sanitizer for the proxy bug** (lines 41-78): `stripSchemaNoise` removes `$schema` + `additionalProperties` (we add `exclusiveMinimum`/`Maximum` in Phase 1). 21 framework detectors, 14 installers, 14 native templates. 17-tool MCP surface with versioned envelope. PKCE OAuth. Skills loader fully wired. Live LLM eval suite with scoring (`evals/`). 47 test files, ~7,580 LOC.

What it gets right: the harness. What it lacks: streaming UI (`generateText`), an explicit presentation interface, mid-run interrupts.

### wizard-rewrite (`~/worktree-repos/wizard-rewrite`)

~9,110 LOC TS. ESM. Cleaner directory layout (`gateway/`, `analytics/`, `auth/`, `core/`, `graph/`, `installers/`, `mcp/`, `cli/wizard-ui/`). Uses `streamText` for the agent loop. **`WizardInstallPresentation` interface** (`src/cli/wizard-ui/types.ts:1-60`) is the explicit "swap to Ink/TUI" seam. LangGraph **interrupts** done correctly via `confirm-framework-node.ts` raising `GraphInterrupt` and `runInstallCli` resuming via `new Command({ resume })`.

**The LangGraph dependency is unjustified for this workload.** Vercel AI SDK v6 now solves the same human-in-the-loop pause/resume via `stopWhen` + tool-call-as-interrupt + `prepareStep`. Adopting wizard-rewrite as-is means the team runs two state machines, two retry models, two telemetry shapes — exactly the two-stack drift this plan elsewhere argues against. **The pieces of wizard-rewrite worth taking are `WizardInstallPresentation` (~60 LOC) and the directory layout. Drop the rest.**

What wizard-rewrite lacks: working sanitizer (same 400 bug), wired agent loop (one demo tool), skills loader, PKCE login, native templates, taxonomy/instrumentation/apply pipeline, multi-account auth, sessions list/show/rm/prune.

### context-hub (`~/worktree-repos/context-hub`)

`@amplitude/context-hub@1.2.0`. Three input streams: `mcp-marketplace` upstream + `transformation-config/` (config-based skills generated from docs + `basics/` example apps) + in-tree `skills/{instrumentation, taxonomy, wizard}`. Output: ~50 skill ZIPs + `manifest.json` + `skill-menu.json` + `skills-mcp-resources.zip` published to a versioned GitHub Release. CI enforces 1 MB per skill / 8 MB bundle, runs prompt-injection scanner, env-var-naming lint, triggers wizard E2E against test apps. Frontmatter has only `name` + `description`. Wizard pulls `latest` unpinned (`wizard/scripts/refresh-skills.sh:96`) — that's the actual drift vector. Runtime fetch infrastructure exists in `wizard-tools.ts` but is currently disabled.

### What to carry forward vs. discard

**Carry forward:**
- The shipped wizard's Ink TUI architecture (lift onto `WizardInstallPresentation`).
- Atomic-write infrastructure, session-checkpointing, storage-paths abstraction.
- Observability infra (`src/lib/observability/`).
- Middleware pipeline, safety scanner.
- context-hub itself: skills format, build pipeline, size budgets, prompt-injection scanner.

**Discard:**
- `runAgentLocally`, `console-query.ts` (third LLM path).
- The 1,569-LOC `runAgent` function — state-machine it.
- 200-LOC `createPreToolUseHook` and 225-LOC `wizardCanUseTool` — drive from a small policy table wrapped via `withWizardPathPolicy(tool)` helper.
- Mirror SDK types — move to ESM, drop dynamic import.
- Dead PostHog frameworks (`unreal`, `unity`, `flutter`, `go`, `java` — verify via telemetry first).
- Hand-rolled `stripStreamEventNoise`.
- One of the two MCP stacks.
- `zod-to-json-schema`, `xcode`, `chalk@2.4.2`.
- `ampli.json` and `~/.ampli.json` reads (major version bump after telemetry confirms).
- **LangGraph from wizard-rewrite — never adopt it.**

---

## 5. Rewrite vs. Incremental Verdict

**Verdict: Single new foundation. Take wizard-v2's harness + sanitizer + tools + skills + evals + templates, lift them onto a fresh repo whose presentation layer matches wizard-rewrite's `WizardInstallPresentation` interface, and ship the Ink TUI as a new implementation of that interface. Drop LangGraph entirely. The shipped wizard goes onto life-support after Phase 1.**

This is not a hedge. It's a specific, defensible call grounded in three observations.

### Why a new foundation, not incremental migration

1. **The legacy debt is concentrated in the files an incremental migration would touch first.** `agent-interface.ts` (4,112 LOC), `wizard-tools.ts` (1,964 LOC), and `agent-runner.ts` (1,835 LOC) are the agent harness — exactly what the Vercel AI SDK migration must replace. Refactoring these in place means rewriting the same code under live production load.

2. **The mirror-types / dynamic-import pattern goes away in ESM.** `agent-interface.ts:97-148`, `agent-hooks.ts:5-29`, `middleware/schemas.ts:87+` are duplication only because the package is CJS. Migrating shipped wizard to ESM is itself a major change touching the same files.

3. **`WizardSession` is the load-bearing coupling between TUI and harness.** Lifting the TUI onto `WizardInstallPresentation` forces a clean re-derivation of session shape; in-place migration would let the legacy shape ossify.

### Why neither rewrite is the foundation as-is

- **wizard-v2 is operationally complete but lacks the presentation seam.** Every `cli/wizard/step-*.ts` calls `@clack/prompts` directly. Building `WizardInstallPresentation` on top of it is a flat rewrite of every step.
- **wizard-rewrite has the seam but its harness is broken (no sanitizer) and depends on LangGraph as a second runtime.** Adopting wizard-rewrite as-is means inheriting a problem this plan otherwise spends pages avoiding (two-stack drift).

The third option — and the right one — is to build a new repo structure modeled on wizard-rewrite's directory layout, port wizard-v2's working pieces in, and adopt `WizardInstallPresentation` as the only piece of wizard-rewrite worth keeping. **LangGraph is not adopted.** The install-graph state becomes a small typed state machine driven by Vercel AI SDK tool calls; mid-run human-in-the-loop pauses are tool calls that throw a typed `AwaitUserConfirmation` error caught by the presentation layer.

### What to call this and where it lives

Two options:
- **Option A:** New repo `wizard-core` (or rename `wizard-rewrite` → `wizard-core` after stripping LangGraph and porting wizard-v2 in). Shipped wizard stays as `@amplitude/wizard@1.x` on life-support. Eventual cutover via major version bump (`@amplitude/wizard@2.0.0`) and same npm name. **Recommended.**
- **Option B:** New npm name (`@amplitude/wizard-core`) for parallel publishing, eventual rename. More marketing churn, less risky technically.

**This plan assumes Option A.** Cutover happens in Phase 7 via major version bump.

### What gets ported, in order
1. `wizard-v2/src/llm/client.ts` (sanitizing fetch + schema scrubber + add the missing `exclusive*` keys + switch to `authToken`) → new repo's `src/llm/`.
2. `wizard-rewrite/src/cli/wizard-ui/types.ts` + `create-install-ui.ts` → new repo's `src/cli/`.
3. `wizard-v2/src/agents/tools.ts` (file-reading + grep with sandbox path resolution) → new repo's `src/agents/`.
4. `wizard-v2/src/agents/skills.ts` + `.agents/skills/` → new repo.
5. `wizard-v2/src/agents/{taxonomy,instrumentation,edit-applier}.ts` → new repo.
6. `wizard-v2/src/auth/oauth-login.ts` (PKCE driver) → new repo.
7. Native templates, live eval suite, self-instrumentation telemetry.
8. The shipped wizard's Ink TUI lifted (not rewritten) as a third `WizardInstallPresentation` implementation.

### The honest counter-argument
If timeline pressure says "ship a parity replacement in <1 quarter," **wizard-v2 is the safer single-bet** — operationally complete today with 4× the test surface. The TUI rebuild on top of it is harder but the substrate is closer to production. Default to wizard-v2 in that case, absorb the harder TUI rebuild later. Otherwise, the new-foundation path is right.

---

## 6. Architectural Recommendations

### Agent harness migration to Vercel AI SDK

**Current shipped abstraction → new (Vercel AI SDK 6) primitive:**

| Current (`wizard/src/lib/`) | New |
|---|---|
| `agent-interface.ts` `runAgent` (1,569 LOC) | `ToolLoopAgent` instance + `streamText` |
| `selectModel` + `fallbackModel` | Per-step `prepareStep` + Vercel AI Gateway for provider failover |
| `AUTH_ERROR_PATTERNS` regex retry | Catch typed `APICallError`, classify by `statusCode` |
| `createPreToolUseHook` (200 LOC) | Per-tool `execute` wrapper + `withWizardPathPolicy(tool)` shared helper |
| `wizardCanUseTool` (225 LOC) | Tool-level deny list via `withWizardPathPolicy(tool)`; emit typed `InvalidToolArgumentsError` |
| `stripStreamEventNoise` (60 LOC) | Drop. Use `streamText.fullStream`, ignore non-text-delta chunks |
| `wizard-tools.ts` (1,964 LOC, 9 tools) | 9 files under `src/agents/tools/`; honest expectation ~150-220 LOC each |
| `wizard-mcp-server.ts` (external stdio MCP) | Generated from same tool definitions to avoid two-stack drift |
| `mcp-with-fallback.ts` (746 LOC) | `experimental_createMCPClient` + small fallback path; realistic ~150 LOC |
| `agent-driver.ts` + `scripted-agent-driver.ts` | Keep port pattern; point at Vercel AI SDK |
| `claude-settings-scope.ts` | Delete. Pass `apiKey`/`baseURL`/`headers` explicitly to `createAnthropic` |
| `sanitize-claude-env.ts` | Keep, but only for child processes the wizard spawns (e.g. `pnpm test` runs) |

**Honesty about what won't shrink as much as the table suggests:**
- The Anthropic Agent SDK gives you bash sandboxing, hook ordering, and PreToolUse semantics for free. Vercel AI SDK does not. The 250 LOC of bash policy and `wizardCanUseTool` won't *vanish*; they'll move to a tool-call middleware. Plan for 150-200 LOC, not 50.
- `wizard-tools.ts` decomposes into 9 files of 150-220 LOC each, not 100-200. The original average is ~218 LOC/tool.

**Cross-cutting additions (new):**
- **Vercel AI Gateway** for multi-provider failover. Configure Anthropic direct → Bedrock → Vertex routing in the gateway, retry-on-provider-error in the SDK. Phase 1 enables it for the harness; Phase 2 adopts it everywhere.
- **Prompt caching** via `@ai-sdk/anthropic` 3.x cache control. The commandments + active skill prefix is 5K+ stable tokens — apply `cache_control: { type: 'ephemeral' }` to the system block. Free latency reduction + ~90% cost reduction on cached prefix tokens. Phase 2.
- **Compaction.** AI SDK v6 leaves context compression to userland; use `prepareStep` + a hand-rolled summarizer. Carry forward the existing `state/<attemptId>.json` snapshot pattern.
- **MCP `experimental_` prefix** is load-bearing. Wrap behind an internal interface so a v7 rename isn't a 50-file diff.

**Patterns that need rearchitecting:**
- The 1,569-LOC `runAgent` function decomposes into:
  - `agent.run({ prompt, abortSignal })` — thin wrapper around `streamText`.
  - `journey-state.ts` — journey advancement + stall timer + heartbeat.
  - `tool-result-watcher.ts` — dashboard + event-plan polling.
  - `stream-pill.ts` — throttled status-pill renderer.
  - `model-output-capture.ts` — diagnostics capture.
- `wizard-session.ts` splits into `session-state.ts` (read-only view for screens) + `session-events.ts` (mutations as discrete events).

### Ambient-agent / nested-harness story

When wizard detects it's running inside Claude Code, Cursor, or Cline, route to **MCP-server mode**, not just NDJSON output:

- Wizard registers itself as an MCP server (typed tools: `detect_framework`, `propose_event_plan`, `apply_instrumentation`, `verify_ingestion`).
- The host agent calls these tools instead of the wizard running its own agent loop.
- Eliminates the harness-vs-harness fight by construction — the wizard never makes its own LLM calls in ambient mode.
- Reuses `wizard-mcp-server.ts` (already exists for `amplitude-wizard mcp serve`).
- NDJSON output remains the fallback for ambient harnesses that don't speak MCP (CI runners, generic agents).

This is a structurally better answer than "detect and emit JSON."

### Skills / context architecture

**Recommendation: Keep context-hub as a separate repo. Tighten the contract.**

- **Pin the wizard to a context-hub release version** instead of `latest` (`refresh-skills.sh:96`). Use the existing `SKILLS_BASE_URL` machinery in `wizard-tools.ts`.
- **Add frontmatter validation** in context-hub CI: every skill must have `name`, `description`, `version`, `tools-allowed`, `triggers`.
- **Add a token-budget linter** (≤2,000 tokens per SKILL.md body; references larger but lazy-loaded). Replicate the `wizard-prompt-supplement` lazy-load pattern for heavy instrumentation skills.
- **Add cross-skill invariant tests** for the autocapture-events list.
- **Re-enable runtime `load_skill_menu` / `install_skill`** in `wizard-tools` so per-run skill selection by category works. Three-tier progressive disclosure (name+description always, body on activation, references lazy) becomes a runtime contract, not just CI.
- **Move `skills/wizard/wizard-prompt-supplement`** into the wizard repo (it's wizard-only). Keep instrumentation/taxonomy/integration in context-hub.
- **MCP Apps (SEP-1865)** for interactive responses — adopt in Phase 6+ to replace the bespoke `confirm` / `confirm_event_plan` tools.

### Repo structure rationalization

- Three repos: new wizard foundation (becomes `@amplitude/wizard@2.0.0`), context-hub, and (during transition only) shipped `@amplitude/wizard@1.x` on life-support.
- **Delete `wizard-v2` and `wizard-rewrite` after the port is complete.** Don't maintain four CLI repos.
- `marketplace-internal`, `mcp-marketplace`, `builder-skills` — **[unverified — not local]**. Open question.

---

## 7. Phased Migration Roadmap

**Total estimate: 28-36 engineer-weeks across 9 phases.** First-draft estimate of 16-22 weeks was optimistic by ~1.5x per the PM review; this is closer to honest.

**Ship order optimized for user value:** 1 → 2a → 5 → 3 → 2b → 4 → 6 → 7 → 8. Ambient-agent ships before TUI rebuild because it's the higher-leverage user win (today's pain is bug + agent friction, not TUI).

### Phase 1 — Stop the bleeding (1-2 weeks, 1 engineer)
**Goal:** Fix the `--agent` API 400 bug for users on shipped wizard today.
**Pre-work (1 day):** Confirm the exact Vertex rejection by reading the App API's `[WizardProxy] Upstream error` logs in Datadog for a recent failing request. The proxy logs the upstream body (truncated to 500 chars) at `app-api/src/wizard-proxy/router.ts:927`. This tells us whether to ship just the beta strip, just the schema strip, or both.
**Scope:**
- In `wizard/src/lib/agent-interface.ts:2969`, env-gate `betas: ['context-1m-2025-08-07']` behind `AMPLITUDE_WIZARD_GATEWAY_BETAS=1`. Default off on the gateway path. Delete the misleading "falls back to 200K" comment.
- Add a sanitizing fetch wrapper that strips `anthropic-beta` and `$schema`/`additionalProperties`/`exclusiveMinimum`/`exclusiveMaximum` from `tools[].input_schema`. Port wizard-v2's `sanitizingFetch` and **add the two missing exclusive keys**.
- Update `fallbackModel` to `claude-sonnet-4-6`.
- Tighten the 400 retry classifier (`agent-interface.ts:3492-3552`) to detect `"Invalid request sent to model provider"` and emit `gateway_400_invalid_request` with a clear remediation message.
- Add a regression test that asserts the wire request body never contains `$schema`, `additionalProperties`, `exclusiveMinimum`, `exclusiveMaximum`, or `anthropic-beta` headers in `--agent` mode.
- Ship as `@amplitude/wizard@<next-patch>`.
**Definition of done:** Users running `npx @amplitude/wizard --agent` inside Claude Code, Cursor, and Cline complete a wizard run without 400. Telemetry shows the 400 rate on `--agent` drops by ≥95%.

### Phase 2a — Foundation harness (3 weeks, 1-2 engineers)
**Goal:** New repo with a working agent loop end-to-end on Vercel AI SDK, against the live proxy, with one real tool.
**Scope:**
- Pick `wizard-rewrite` as the *layout* foundation. Strip LangGraph. Rename to `wizard-core` (or merge into `wizard` and delete `wizard-rewrite`).
- Pin auth pattern: `authToken` via `@ai-sdk/anthropic` 3.x. Validate end-to-end against the App API's `authenticate` middleware on day 1.
- Pin model id: `claude-sonnet-4-6` via `WIZARD_CLAUDE_MODEL`.
- Port wizard-v2's `LlmClient` sanitizer (with `exclusive*` additions) into `src/llm/`.
- Port wizard-rewrite's `WizardInstallPresentation` interface + `ClackWizardInstallPresentation` + `MachineJsonInstallPresentation`.
- Wire `streamText` via `ToolLoopAgent` for the agent loop (not `generateText`).
- One real tool end-to-end: `read_file` from wizard-v2.
- Vercel AI Gateway integration enabled (provider failover Anthropic → Bedrock → Vertex).
- Prompt caching via `cache_control: { type: 'ephemeral' }` on the commandments system block.
- Live LLM evals harness ported (`evals/runner.ts`, scoring rubric).
**Definition of done:** Agent loop runs against the live proxy with sanitization + caching + gateway failover. Live LLM evals match wizard-v2's baseline on the read_file path.

### Phase 5 — Ambient agent first-class support (2 weeks, 1 engineer)
**Goal:** Wizard runs cleanly inside any agent harness via MCP-server-mode.
**Scope:**
- Vendor or port `@vercel/detect-agent`'s detection table.
- When ambient agent detected: route to `wizard-mcp-server.ts` (already exists for `amplitude-wizard mcp serve`). Wizard exposes typed tools (`detect_framework`, `propose_event_plan`, `apply_instrumentation`, `verify_ingestion`); the host agent drives. No wizard LLM calls in ambient mode.
- Fallback path for ambient harnesses that don't speak MCP: NDJSON output with versioned schema, semantic exit codes.
- Refuse to run with `sk-ant-oat01-…` OAuth subscription tokens (Anthropic policy) — emit structured error.
- E2E tests: spawn wizard inside Claude Code CLI, assert successful MCP-tool-call completion.
- Document the env-var contract in `docs/ambient-agent-mode.md`.
**Definition of done:** `npx amplitude-wizard install` inside Claude Code completes without 400 and via the MCP-server path. Smoke-tested on Cursor, Cline, Codex CLI, Copilot CLI.

### Phase 3 — Native templates and detection parity (2-3 weeks, 1 engineer + 1 week telemetry analysis)
**Goal:** Match shipped wizard's framework matrix.
**Pre-work:** Pull telemetry on framework usage from the shipped wizard. **If `unreal`, `unity`, `flutter`, `java`, `go` show <0.5% usage, drop them.** Owner + deadline must be assigned in Phase 2a.
**Scope:**
- Port wizard-v2's 14 native templates (Swift/Kotlin/Flutter/Unity/Unreal/Java/Go/Python — minus whatever telemetry kills).
- Add the detectors wizard-rewrite is missing for surviving frameworks.
**Definition of done:** Detector + installer parity for every framework with non-trivial usage. E2E tests against test apps pass.

### Phase 2b — Foundation breadth (4 weeks, 1-2 engineers)
**Goal:** Port the rest of wizard-v2's working pieces onto the new foundation.
**Scope:**
- Port wizard-v2's `src/agents/tools.ts` (file-reading + grep with sandbox path resolution) — 9 tools across `src/agents/tools/`.
- Port wizard-v2's `src/agents/skills.ts` and `.agents/skills/`; wire to context-hub at runtime.
- Port wizard-v2's `src/agents/{taxonomy,instrumentation,edit-applier}.ts`.
- Port wizard-v2's `src/auth/oauth-login.ts` (PKCE driver).
- 17-tool MCP surface on the new foundation, generated from the same tool definitions used by the agent loop.
- Self-instrumentation telemetry via `@amplitude/analytics-node`.
**Definition of done:** All wizard-v2 unit tests pass on the new foundation. Live LLM evals match or exceed wizard-v2's baseline across taxonomy and instrumentation paths.

### Phase 4 — TUI lift (8-10 weeks, 2 engineers)
**Goal:** Ink-based TUI plugged into `WizardInstallPresentation`. Visual + UX parity with shipped wizard.
**Scope:**
- Implement `InkWizardInstallPresentation` against `WizardInstallPresentation`. Single-file factory swap.
- **Lift, don't rewrite** the shipped wizard's `flows.ts` declarative pipeline, `router.ts` overlay stack, `screen-registry.tsx`, `useScreenInput`, `useEscapeBack`, fast-check property-based flow tests.
- Re-implement the 17 screens against the new session shape (`session-state.ts` + `session-events.ts` split).
- Decompose `AuthScreen.tsx` (965 LOC) and `DataIngestionCheckScreen.tsx` (1,142 LOC): extract IO/business logic into hooks/services; screens render-only.
- Re-implement slash commands (`/region`, `/login`, `/logout`, `/whoami`, `/create-project`, `/mcp`, `/slack`, `/feedback`, `/clear`, `/help`, `/debug`, `/diagnostics`, `/snake`, `/exit`).
- **Opt-in beta flag:** users can run `AMPLITUDE_WIZARD_NEXT=1 npx amplitude-wizard` to try the new TUI ahead of cutover. Default stays on the shipped wizard until Phase 7.
**Definition of done:** New TUI passes the shipped wizard's flow invariant property tests. Visual diff shows no regression on golden-path screenshots. Two weeks of internal dogfood passes without showstoppers. Beta flag enabled in production for opt-in users.

### Phase 6 — context-hub contract tightening (2 weeks, 1 engineer)
**Goal:** Skills delivery is versioned, validated, token-budgeted.
**Scope:**
- Pin wizard-core to a specific context-hub release tag (replace `latest` lookup).
- Add frontmatter validator in context-hub CI: enforce `name`, `description`, `version`, `tools-allowed`, `triggers`.
- Add token-budget linter: ≤2,000 tokens per SKILL.md body; references larger but only loaded on demand.
- Add cross-skill invariant test for the autocapture-events list.
- Re-enable `load_skill_menu` / `install_skill` runtime tools.
- Move `skills/wizard/wizard-prompt-supplement` into the wizard repo.
**Definition of done:** context-hub CI fails on missing required frontmatter or oversized skills. Wizard pulls a pinned context-hub version per release.

### Phase 7 — Cutover and packaging (3-4 weeks, 1 engineer)
**Goal:** New foundation becomes `@amplitude/wizard@2.0.0`. Single repo, single LLM client, ESM, modern packaging.
**Scope:**
- Major version bump: `@amplitude/wizard@2.0.0` published from the new repo.
- `@amplitude/wizard@1.x` enters maintenance-only mode (security fixes only, no new features).
- Modern package.json: ESM-only library, CJS bin, `tsup` build, `exports` map, Node 22+.
- `bunx amplitude-wizard@latest` parity with `npx`.
- Changesets for release automation; trusted publishing on CI.
- Single MCP stack (Vercel AI SDK's `experimental_createMCPClient` + the standalone MCP server generated from the same tool defs).
- Final cut of dead deps (`zod-to-json-schema`, `xcode`, `chalk@2.4.2`).
- Documented migration guide for users (mostly a no-op since same package name + flags preserved).
**Definition of done:** v2.0.0 published. Telemetry shows no regression vs. shipped wizard on activation, time-to-first-event, run completion rate. v1.x marked maintenance-only.

### Phase 8 — Drop Ampli legacy and OTel observability (3 weeks, 1 engineer)
**Goal:** Cut compatibility tax + adopt OTel GenAI semantic conventions.
**Scope:**
- Stop reading `~/.ampli.json` and per-project `ampli.json` (`src/utils/ampli-settings.ts` 474 LOC, `src/lib/ampli-config.ts` 371 LOC). One-shot migration on upgrade; old paths read-only for one minor cycle, then deleted.
- Remove `WorkspaceId` migration code in `session-checkpoint.ts`.
- Drop frameworks Phase 3 telemetry killed.
- Adopt OpenTelemetry GenAI semantic conventions for prompt/completion/tool-call spans, content as span events (drop-able at the Collector). Default redacted, opt-in via `OTEL_LOG_USER_PROMPTS=1`.
- Ship as `@amplitude/wizard@2.x` minor.
**Definition of done:** 0 references to `ampli.json` outside one-shot migration code. OTel spans visible in Datadog with content redacted by default. No customer escalation in two weeks post-release.

### Phase 9 — Single-file binary distribution (2 weeks, 1 engineer)
**Goal:** Reduce install funnel friction via a self-contained binary.
**Scope:**
- Evaluate Bun compile vs Node SEA (Feb 2026 improvements) against the wizard's CJS-bin pattern.
- Ship single-file binaries for darwin-arm64, darwin-x64, linux-x64, linux-arm64, win32-x64.
- Distribute via GitHub Releases + Homebrew tap.
- Keep npm install path as the primary distribution.
**Definition of done:** `curl -fsSL https://amplitude.com/install-wizard | sh` works on macOS and Linux. Telemetry shows install funnel drop-off improves.

### Total estimate
~28-36 engineer-weeks across 9 phases. Phases 1, 2a, 5, 3 are independently shippable user wins delivering value in months 1-3. Phase 4 (TUI rebuild) is the biggest variance driver — budget 8-10 weeks honestly, not 4-6.

---

## 8. Decisions and Open Questions

Three of the original "open questions" were really decisions deferred. Decisions are pinned here; remaining open questions are below.

### Decisions made in this plan (binding unless reopened by team)
1. **Foundation strategy: new repo (`wizard-core`/`wizard@2`), wizard-v2 harness onto wizard-rewrite presentation seam, no LangGraph.** (Was Open Q2.)
2. **Auth pattern: `authToken` via `@ai-sdk/anthropic` 3.x.** (Was implicit.)
3. **Model id: `claude-sonnet-4-6` via `WIZARD_CLAUDE_MODEL`.** (Was implicit.)
4. **Cutover: same npm name (`@amplitude/wizard`), major version bump `@amplitude/wizard@2.0.0` in Phase 7.** (Was Open Q7 in old plan.)
5. **TUI: lift, don't rewrite.** (Was Open Q3.)
6. **Ambient mode: MCP-server-mode primary, NDJSON fallback.** (Was Phase 5 reframe per architecture review.)

### Remaining open questions
1. **`marketplace-internal`, `mcp-marketplace`, `builder-skills` access.** Not in the local worktree. context-hub references `mcp-marketplace` as the upstream source for instrumentation skills (`scripts/refresh-instrumentation-skills.sh`); none of the four repos audited reference `builder-skills`. **Action:** confirm whether these are real Amplitude repos and grant access if they are, or remove them from the brief if they aren't. **Owner needed.**
2. **Native framework cut.** Phase 3 depends on telemetry analysis to drop dead frameworks. **Action:** assign owner + deadline for the framework-usage telemetry pull before Phase 2a kicks off. **Owner needed.**
3. **context-hub reorganization downstream consumers.** This plan moves `skills/wizard/wizard-prompt-supplement` into the wizard repo and keeps shared skills in context-hub. The Amplitude MCP server (and possibly other consumers) may expect the wizard skills in context-hub's release. **Action:** check downstream consumers before Phase 6.
4. **Telemetry redaction default.** Plan recommends matching Anthropic Claude Code's default (redacted with `OTEL_LOG_USER_PROMPTS=1` opt-in). **Action:** confirm with security/legal before Phase 8.
5. **Shipped wizard life-support window and ownership.** Phases 2-7 ship to a new repo while users remain on `@amplitude/wizard@1.x` for ~6 months. Plan says "security only," but no owner is named. **Action:** name a maintenance owner before Phase 2a.
6. **Single-file binary platform matrix.** Phase 9 lists five targets. **Action:** confirm Windows is in scope; Bun compile has weaker Windows support than Node SEA today.
7. **MCP Apps (SEP-1865) adoption timing.** Plan flags it as Phase 6+. **Action:** decide whether MCP Apps replaces `confirm_event_plan` in v2 or v3.
8. **Beta flag policy.** Phase 4 introduces `AMPLITUDE_WIZARD_NEXT=1` for opt-in TUI. **Action:** decide rollout cohorts (employees only first? % rollout? Customer council?).
