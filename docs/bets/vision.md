## @amplitude/wizard — The Vision

### The core insight

The wizard is a well-architected product whose core loop, telemetry spine, and backend surface are all undertuned relative to how good they could be. Ten independent expert reviews converged on one diagnosis: the individual fixes are cheap, but nobody has integrated them into a single story. This is that story.

### What's true today

1. **The agent loop is opaque.** No prompt caching (50–80% input-token savings left on the table per `src/lib/middleware/benchmarks/cache-tracker.ts`). Twelve SDK hooks declared, only `Stop` wired. Status scraped from plaintext text markers. No eval harness.
2. **Nothing correlates across the wire.** No `traceparent` / `X-Wizard-Run-Id` on outbound calls. Cost/tokens gated behind `--benchmark`. Outcome split across `OutroKind` × `McpOutcome` × `ExitCode` × `AgentErrorType`. `anonymousId` regenerated per run, silently breaking experiment stickiness.
3. **The proxy is a single-provider shim with no experimentation surface.** Vertex-only (`statuspage.ts:123-128` no-ops the provider check). Model hardcoded in `agent-interface.ts:768`. No budget protocol, no edge cache, no failover.

Every expert's "bold bet" traces back to one of these three. So we can bet on five things in sequence, and everything downstream compounds.

### The five bets

| # | Bet | Impact | Depends on |
|---|---|---|---|
| 1 | **Observability spine** — trace propagation, always-on cost/tokens, canonical funnel events, persistent `anonymousId`, session-trace artifact | Unlocks every measurement, experiment, and incident workflow | — |
| 2 | **Agent loop overhaul** — prompt caching, three-phase planner/integrator/instrumenter pipeline, structured status, real hooks, eval harness | 50–80% cost reduction, dramatically better cold-start, localized failures | Bet 1 |
| 3 | **AI Gateway** — GCP Cloud Run proxy with multi-provider failover, edge prompt cache, flag-driven model routing, per-org budget protocol, shadow-replay evals | Eliminates single-provider SPOF, turns model choice into a flag not a release | Bet 1 |
| 4 | **MCP-first repositioning** — ship as "Amplitude for Claude Code / Cursor," harden `mcp serve`, wire the 13 context-hub skills not yet registered, cut scope | Where the dev market is going in 18 months | Bets 2 + 3 |
| 5 | **Recovery & delight** — error outro as launchpad, persistent launch-pad TUI, `/help` overlay, kill auth for returning users, PLG teammate-invite loop | Difference between "tool devs finish" and "tool devs screenshot" | — |

### Sequence

```
Bet 1 (obs spine)  ──┬──→  Bet 2 (agent loop)  ──┬──→  Bet 4 (MCP-first)  ──→  ...
                     │                            │
                     └──→  Bet 3 (gateway)  ──────┘
                                                        Bet 5 (UX) runs in parallel throughout.
                                                        Hardening runs in parallel throughout.
```

Bets 1 and 5 and Hardening start today. Bets 2 and 3 start when Bet 1 lands; they overlap. Bet 4 waits for 2 + 3 because MCP clients need the structured agent surface and gateway doesn't want to lock to one LLM.

### Table-stakes hardening (runs alongside every bet)

Three security fixes, all ~S effort, all High severity: (a) replace `execSync`-with-interpolated-key in `src/utils/api-key-store.ts` with `execFileSync` + argv; (b) validate OAuth `state` in `src/utils/oauth.ts` and use an ephemeral callback port; (c) add `--provenance` to `pnpm publish` in `.github/workflows/`.

Three god-file splits before any bet builds on top of them: `bin.ts` (2,033 lines), `src/lib/agent-interface.ts` (1,703 lines), `src/ui/tui/store.ts` (939 lines). Lint guard that fails CI if any exceeds its line budget.

### North Star

**Time-to-first-event-in-chart**, segmented by framework × first-vs-returning × region. Published weekly. Every bet rolls out behind a flag; 14-day bake; gate promotion against lift.

### Kill criteria per bet

- Bet 2: cache hit rate <40% after two weeks → revert to flag-gated rollout.
- Bet 3: failover introduces >100ms p95 regression → route only failover paths through the new router.
- Bet 4: MCP signups <10% after two quarters → MCP becomes side channel, CLI stays primary.
- Bet 5: teammate-invite k<0.05 after 30 days → deprecate the invite prompt.

### What we're deliberately NOT doing

- A TUI rewrite on `@clack/prompts`. The Ink stack cost is known; the return isn't there until Bet 4 clarifies whether the TUI is still primary.
- A hosted "paste-URL-get-PR" orchestrator. If Bet 4 works, that becomes a natural consequence. Don't build it first.
- Per-framework first-class configs for Unreal / Unity / Go / Java — cut in Bet 4.
- New slash commands beyond `/help` until existing ones match the README.

### The ask

Approve the bet-1 + hardening + bet-5 workstreams to start immediately. Bets 2 and 3 sequence behind Bet 1. Bet 4 unlocks when 2 and 3 both ship.
