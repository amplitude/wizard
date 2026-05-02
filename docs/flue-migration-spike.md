# Flue migration — spike report

**Status:** Spike complete, full migration **not yet executed**, awaiting decision.
**Spike branch:** `spike/flue-migration`
**SDK probed:** `@flue/sdk@0.3.5` (published 2 days before this spike, marked **Experimental**).
**Wizard runtime today:** `@anthropic-ai/claude-agent-sdk@0.2.121` on Node 20.19.6.

## TL;DR

A full rewrite of the wizard's agent layer onto Flue is technically possible
but currently produces a **regressed product** unless the rewrite reconstructs
several Claude-Agent-SDK surfaces with custom wrapper code — which contradicts
the goal of using Flue idiomatically.

The recommended path forward is **do not migrate now**, and revisit when Flue
exposes (a) a stable public programmatic-embed API, (b) a tool-approval
hook, and (c) lifecycle hooks comparable to Claude Agent SDK's
`Stop` / `SessionStart` / `PostToolUse` / `UserPromptSubmit`.

If the migration must proceed regardless, it is a **3–6 engineer-day** effort
plus 1–2 days of validation, with explicit, documented behavior regressions
(see "Cost estimate" below).

## How the spike was conducted

1. Mapped every Claude Agent SDK touchpoint in this repo (5 runtime files,
   ~9 000 LOC across `agent-interface.ts`, `wizard-tools.ts`, `agent-runner.ts`,
   `agent-hooks.ts`, `console-query.ts`, `mcp-with-fallback.ts`, plus 4 test
   mocks).
2. Inspected the actual `@flue/sdk@0.3.5` install — read the published
   `.d.mts` files for `index`, `client`, `internal`, `node`, `cloudflare`.
3. Wrote a minimal probe that imports `createFlueContext` from
   `@flue/sdk/client` and calls `ctx.init({ ... }).session().prompt(...)`
   in-process from a plain Node 20 script (i.e. the shape the wizard would
   need in `agent-interface.ts`). Ran it; captured what worked and what
   needed BYO infrastructure.

The probe is reproducible from this branch by `pnpm add @flue/sdk` and
running the script in [Appendix A](#appendix-a--probe-script).

## Findings (with evidence)

### 1. Node 22 vs Node 20 — published-package compatibility break

Flue's build target and inline documentation state Node 22+:

```
node_modules/@flue/sdk/dist/index.mjs:1022:    target: "node22",
node_modules/@flue/sdk/dist/index.d.mts:86:    Flue requires Node 22+.
```

The wizard ships as `@amplitude/wizard@1.15.0` on npm with
`engines.node: ">=20"`. Migrating onto Flue without bumping the engine
either (a) silently risks runtime failures on Node 20 LTS, or (b) requires
a major-version bump and DX regression for every user still on Node 20.

The probe confirmed Flue's runtime *currently* boots on Node 20.19.6, but
that's not a contract — Flue's stated minimum is 22, and any
forward-looking use of Node 22-only APIs in pi-agent-core or pi-ai will
break us silently.

### 2. `@flue/sdk@0.3.5` is explicitly experimental, with wildcard transitive deps

From `npm view @flue/sdk` (read at spike time):

> **Experimental** — Flue is under active development. APIs may change.

Transitive deps:

```
@mariozechner/pi-agent-core: *
@mariozechner/pi-ai: *
```

Wildcard ranges in a runtime SDK mean any breaking change in
`pi-agent-core` or `pi-ai` immediately propagates to every wizard install
that resolves a fresh tree. For a published CLI that gets executed via
`npx`, this is a real supply-chain stability concern.

### 3. No public programmatic-embed API; `createFlueContext` is on `/client` and `/internal`

The wizard calls Claude SDK as `for await (m of query({ prompt, options }))`
from regular TypeScript code. Flue's documented surface for invocation is:

- `flue run <agent>` (CLI)
- `flue dev` (dev server, HTTP on port 3583)
- `flue build → dist/server.mjs` (production HTTP/Workers entrypoint)
- `triggers = { webhook: true | cron: '...' }` exported from agent modules

The shape Flue *does* expose for in-process use lives at:

- `@flue/sdk/client` — `createFlueContext`, `connectMcpServer`, `Type`
- `@flue/sdk/internal` — `InMemorySessionStore`, `bashFactoryToSessionEnv`,
  `resolveModel`

The `/internal` subpath name is a deliberate stability signal. The
probe confirmed `createFlueContext({...}).init({...}).session().prompt(...)`
works in-process, but the caller must BYO `SessionEnv`, `SessionStore`,
`createDefaultEnv`, `createLocalEnv`, and `agentConfig`. This is the seam
Flue exposes between its build output and the agent harness — usable, but
load-bearing on internals that may shift.

### 4. In-process MCP is not supported

`wizard-tools.ts` runs an in-process MCP server consumed by the wizard's
own internal Claude agent (`createSdkMcpServer` from Claude SDK). Flue's
MCP integration:

```
connectMcpServer(name, { url: string | URL, transport: 'streamable-http' | 'sse', ... })
```

is HTTP/SSE only. There is no stdio transport and no in-process server
constructor.

Migration paths:
- **Option A:** Rewrite the 8 wizard tools as Flue `ToolDef[]` directly.
  Cleaner. Deletes the deliberate MCP boundary in `wizard-tools.ts`. Loses
  the dual-purpose nature of that module (it also backs the *external*
  `wizard-mcp-server.ts` consumed by Claude Code / Cursor / Codex).
- **Option B:** Stand up a localhost HTTP MCP shim in front of the
  existing in-process server, so Flue talks to it via `streamable-http`.
  Preserves the MCP boundary but is exactly the "wrap Flue to behave like
  Claude SDK" pattern flagged as out-of-bounds.

### 5. Tool schemas: TypeBox, not Zod

All 8 wizard tools today use Zod schemas. Flue's `ToolDef.parameters` is
TypeBox-style `Type.Object({...})` (re-exported from `@mariozechner/pi-ai`).
Migration requires rewriting every parameter schema and any
`zod-to-json-schema` glue. Tool result schemas (e.g. `confirm_event_plan`'s
returned plan) move to **Valibot** (`v.object`, `v.string`, etc.).

### 6. No tool-approval hook, no lifecycle hooks

`src/lib/agent-hooks.ts` registers 9 hook types with the Claude SDK:

| Hook | What it powers today |
|---|---|
| `PreToolUse` | **Safety scanner: blocks destructive bash (`rm -rf /`, etc.)** |
| `PostToolUse` | Journey-state file-change tracking |
| `PostToolUseFailure` | Tool-error logging |
| `UserPromptSubmit` | Inject session context into prompts |
| `SessionStart` | Initialize logging + telemetry |
| `SessionEnd` | Cleanup, finalize telemetry |
| `Stop` | Drain feature queue at end-of-turn |
| `PreCompact` | Archive transcript before summarization |
| `PermissionRequest` | Custom permission handling |

Flue exposes a single `FlueEventCallback` with these events:
`agent_start | text_delta | tool_start | tool_end | turn_end | command_start | command_end | task_start | task_end | compaction_start | compaction_end | idle | error`.

Critical gaps:
- **No `PreToolUse` equivalent.** `tool_start` fires *after* the tool has
  begun. Tool-call interception (the safety guard) requires wrapping each
  tool's `execute` function manually.
- **No `Stop` / `UserPromptSubmit` / `SessionStart` / `SessionEnd`.**
  Telemetry that fires on these would have to be derived from
  `turn_end` / `idle` / `agent_start` plus custom bookkeeping in the host
  process.
- **No permission callback.** `bypassPermissions` is implicit — all tool
  calls run.

### 7. Streaming granularity is materially coarser

The Ink TUI's `ConsoleView` consumes `SDKMessage`s and renders:

- assistant text (incremental)
- thinking blocks (`type: 'thinking'` content blocks)
- tool-use blocks with **tool name + input JSON** as the call is being made
- tool-result blocks with full output
- `system` init message carrying model identifier and available tools
- `result` message with token usage

`FlueEventCallback` provides `text_delta` (text only), `tool_start` and
`tool_end` (no per-call input streaming, no model-identifier event, no
thinking blocks, no usage deltas).

Without further wrapping, the agent-mode NDJSON stream and the TUI
ConsoleView both lose information that's currently surfaced to users and to
agent-mode consumers. Reconstructing it requires wrapping every tool's
`execute` to emit pseudo-events, plus tracking turn-level state outside of
Flue.

### 8. Sandbox path remap

Flue's `local` sandbox mode mounts `process.cwd()` at `/workspace` inside
the agent's view. The wizard surfaces real `installDir` paths in:

- Telemetry (`'install dir'` group property)
- Per-project debug log paths (`~/.amplitude/wizard/runs/<sha256(installDir)>/`)
- Session checkpoints
- Editor MCP install (Claude Code / Cursor / Codex configs all reference
  the user's actual project path)

A custom `BashFactory` wrapping a host `Bash` instance whose
`cwd === process.cwd()` is the cleaner answer — but that's net-new
infrastructure, not idiomatic Flue.

### 9. Mandatory build step

Flue's HTTP/cron invocation requires `flue build` → `dist/server.mjs`
(esbuild). `pnpm try` today runs the wizard from source via `tsx`. A Flue
rewrite must either:

- Adopt `flue build` into the dev loop (slower iteration), or
- Bypass Flue's build entirely and use `createFlueContext` from
  `@flue/sdk/client` directly (the "internal-not-for-user-code" path).

## What the spike confirmed *does* work cleanly

To be balanced — these surfaces port without friction:

- **Skills** — wizard's `skills/integration/`, `skills/instrumentation/`,
  `skills/taxonomy/` are already markdown with frontmatter; relocate to
  `.agents/skills/<name>/SKILL.md`.
- **Roles** — natural fit for "framework specialist" (per integration),
  "taxonomy planner", "reviewer" personas.
- **Subagents** — `session.task()` covers the (currently disabled by
  commandment) delegation path.
- **Structured confirmations** — `prompt(..., { result: vSchema })` with
  Valibot replaces the `confirm_event_plan` style return-shape contract.
- **AGENTS.md** — `commandments.ts` ports cleanly to a workspace-root
  `AGENTS.md` discovered into the system prompt.
- **`session.task()` task-depth cap of 4** — matches the wizard's stated
  "do not spawn subagents recursively" stance.

## Cost estimate for full migration (if it proceeds)

| Surface | LOC affected | Work |
|---|---|---|
| `agent-interface.ts` | 4 112 | Rewrite query loop, message-type Zod schemas, hook plumbing, abort wiring, env/header injection |
| `wizard-tools.ts` | 1 964 | Convert 8 in-process MCP tools to Flue `ToolDef[]`; Zod → TypeBox |
| `agent-runner.ts` | 1 835 | Rework universal runner against `agent.session()` lifecycle, telemetry hook re-derivation |
| `mcp-with-fallback.ts` | 746 | Rewrite fallback agent with `createFlueContext` |
| `agent-hooks.ts` | 189 | Rewrite as tool-execute wrappers + FlueEventCallback derivation; lose PreToolUse safety guard or reimplement per-tool |
| `console-query.ts` | 168 | Direct port to `session.prompt()` |
| `middleware/schemas.ts` | n/a | Replace Claude `SDKMessage` Zod schemas with Flue event schemas |
| `wizard-mcp-server.ts` | n/a | Stays — external MCP server is consumed by *other* AI agents, not the wizard's own runtime. But it currently shares code with `wizard-tools.ts`; the boundary needs re-drawing. |
| Test mocks (5 files) | ~600 | Rewrite all `vi.mock('@anthropic-ai/claude-agent-sdk', ...)` callsites against Flue |
| `vitest.config.ts` | small | Replace mock alias |
| `package.json` | small | Drop `@anthropic-ai/claude-agent-sdk`, add `@flue/sdk`; **bump engines.node to >=22** |
| Net-new: `BashFactory` wrapping host shell with real cwd | ~300 | New code, not in repo today |
| Net-new: `SessionStore` adapter to wizard checkpoint/state | ~150 | New code |
| Net-new: per-tool execute wrappers replacing `PreToolUse` safety guard | ~200 | New code, security-sensitive |
| 18 framework integrations | review pass | Skill content unchanged, but each `*-wizard-agent.ts` glue may need updates |
| BDD features + e2e applications | review pass | Likely several `expect`s on agent output strings need updating |
| `docs/architecture.md`, `docs/dual-mode-architecture.md`, `docs/external-services.md`, `CLAUDE.md` | rewrite | All reference Claude SDK by name and behavior |

**Engineer-time estimate:** 3–6 days of focused work for an engineer
familiar with this codebase, plus 1–2 days of validation
(`pnpm test`, `pnpm test:bdd`, `pnpm test:e2e`, `pnpm test:proxy`,
manual run against test applications in `e2e-tests/test-applications/`).

**Behavior regressions if migration proceeds without re-implementing the
gaps:**

- ❌ Destructive-bash safety guard (`PreToolUse`) — gone
- ❌ Stop / SessionStart / SessionEnd telemetry hooks — gone unless
  derived from `turn_end` + manual bookkeeping
- ❌ Thinking-block display in TUI — gone
- ❌ Tool-call **input** streaming in TUI — gone (only `tool_start` /
  `tool_end` notifications)
- ❌ Per-message model identifier in `system` init message — gone
- ❌ `PreCompact` transcript archiving — gone unless reconstructed
- ⚠️ Agent-mode NDJSON consumers will see a different schema —
  breaking change for any external orchestrator that parsed `SDKMessage`

Each of these can be reconstructed in user-land, but doing so produces
exactly the kind of "wrap Flue to behave like Claude SDK" pattern that
violates the "Flue used idiomatically" goal.

## Recommendation

**Do not migrate at this time.** The architectural fit is poor for the
specific surfaces the wizard depends on most (in-process embed, in-process
MCP, tool-approval hook, granular streaming), the SDK is explicitly
experimental and 2 days old at spike time, and the Node 22 engine
requirement is a published-package break for an actively-shipping CLI on
Node 20 LTS.

**Re-evaluate Flue when:**

1. A stable public programmatic-embed API exists (without relying on
   `@flue/sdk/internal` or `@flue/sdk/client` undocumented seams).
2. A tool-approval hook (`PreToolUse` analogue) lands.
3. Lifecycle hooks (`Stop`, `SessionStart`, `UserPromptSubmit`) land or
   are explicitly designed for derivation from the event stream.
4. Either Flue supports an in-process MCP transport, or the wizard
   refactors `wizard-tools.ts` to drop the in-process MCP boundary on its
   own schedule.
5. `@flue/sdk` reaches 1.0 (or comparable stability signal) and pins its
   `pi-*` transitive deps.

If the decision is to migrate anyway, the architecture sketch in
[Appendix B](#appendix-b--full-migration-architecture-sketch) is the
recommended shape — **but expect documented regressions to be merged
along with it.**

## Appendix A — probe script

Reproducible from this branch with `pnpm add @flue/sdk`:

```js
// /tmp/flue-spike/probe.mjs
import { createFlueContext, Type } from '@flue/sdk/client';

const tools = [{
  name: 'echo',
  description: 'Echo a string',
  parameters: Type.Object({ msg: Type.String() }),
  execute: async (args) => `echoed: ${args.msg}`,
}];

const ctx = createFlueContext({
  id: 'probe',
  payload: {},
  env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '' },
  agentConfig: { id: 'probe', model: 'anthropic/claude-haiku-4-5', tools, sandbox: 'empty' },
  createDefaultEnv: async () => { /* BYO SessionEnv via bashFactoryToSessionEnv */ },
  createLocalEnv: async () => { /* BYO SessionEnv via bashFactoryToSessionEnv */ },
  defaultStore: { /* BYO SessionStore */ },
});

ctx.setEventCallback((evt) => { /* coarse stream: text_delta, tool_start, tool_end, turn_end, idle */ });
const agent = await ctx.init({ model: 'anthropic/claude-haiku-4-5', tools, sandbox: 'empty' });
const session = await agent.session();
const result = await session.prompt('say hello');
```

Probe outcome on Node 20.19.6: `ctx.init` resolves, `agent.session()`
resolves, `session.prompt(...)` reaches the `SessionEnv` resolution layer
and asks the caller for `createDefaultEnv` (i.e. requires BYO sandbox
infrastructure, as predicted from the type signatures).

## Appendix B — full migration architecture sketch

Only relevant if the decision is to migrate despite the recommendation.

```
src/lib/flue/
  context.ts        # createFlueContext + InMemorySessionStore + bashFactoryToSessionEnv glue
  bash-factory.ts   # BashFactory wrapping host shell with cwd === process.cwd() (preserves installDir paths)
  session-store.ts  # SessionStore adapter to ~/.amplitude/wizard/state/
  tools/
    check-env-keys.ts        # ToolDef + Type.Object schema (was wizard-tools.ts tool 1)
    set-env-values.ts        # ToolDef
    detect-package-manager.ts
    confirm.ts               # ToolDef + Valibot result schema
    choose.ts
    confirm-event-plan.ts
    report-status.ts
    record-dashboard.ts
    wizard-feedback.ts
  hooks/
    pre-tool-use.ts          # tool-execute wrapper: safety scanner per tool
    telemetry.ts             # FlueEventCallback → analytics events
    journey-state.ts         # FlueEventCallback (tool_end) → file-change tracking
  events.ts          # FlueEvent → SDKMessage-shaped projection for TUI ConsoleView and NDJSON agent mode
  agent-runner.ts    # universal runner using ctx.init().session().prompt()
.agents/
  skills/            # relocated from skills/
.flue/
  agents/
    wizard.ts        # default export ({ init }) => init({ model, tools, sandbox: bashFactory })
  roles/
    framework-specialist.md
    taxonomy-planner.md
AGENTS.md            # commandments.ts content
```

Subagent boundaries (currently disabled, would be enabled selectively):

- **Framework specialist** (per integration) via `session.task(prompt, { role: 'framework-specialist' })` — one task per detected integration.
- **Taxonomy planner** for event-plan generation, with a Valibot result schema for `confirm_event_plan`.
- **Reviewer** for the safety pre-flight scan (tool-execute wrapper invokes a tiny task).
