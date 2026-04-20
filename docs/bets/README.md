# Wizard Vision & Bets

The vision and per-bet briefs that are currently being executed against.

| File | What it covers |
|------|----------------|
| [`vision.md`](./vision.md) | Top-level narrative: the three things that are undertuned today, the five bets that fix them, the sequencing, the North Star, kill criteria, and what's deliberately NOT being done |
| [`bet-1-observability-spine.md`](./bet-1-observability-spine.md) | Unified observability spine — run_id as the universal primary key, always-on cost/tokens, canonical funnel events, persistent anonymousId, session-trace uploader |
| [`bet-2-agent-loop.md`](./bet-2-agent-loop.md) | Agent loop overhaul — prompt caching, three-phase planner/integrator/instrumenter pipeline, structured status, real hooks, eval harness |
| [`bet-3-ai-gateway.md`](./bet-3-ai-gateway.md) | AI Gateway — GCP Cloud Run proxy with multi-provider failover, edge prompt cache, flag-driven model routing, per-org budget protocol, shadow-replay evals |
| [`bet-4-mcp-first.md`](./bet-4-mcp-first.md) | MCP-first repositioning — ship as "Amplitude for Claude Code / Cursor," harden `mcp serve`, wire the 13 context-hub skills not yet registered |
| [`bet-5-recovery-ux.md`](./bet-5-recovery-ux.md) | Recovery & delight — error outro as launchpad, persistent launch-pad TUI, `/help` overlay, kill auth for returning users, PLG teammate-invite loop |

## Live rollup

The GitHub [tracking issue](https://github.com/amplitude/wizard/issues/143) keeps a running checklist of PRs against each bet. Merge order follows the bet sequence; every PR is stacked on its predecessor.

## Sequence

```
Bet 1 (obs spine)  ──┬──→  Bet 2 (agent loop)  ──┬──→  Bet 4 (MCP-first)  ──→  ...
                     │                            │
                     └──→  Bet 3 (gateway)  ──────┘
                                                        Bet 5 (UX) runs in parallel throughout.
                                                        Hardening runs in parallel throughout.
```

Bets 1 and 5 and Hardening started immediately. Bets 2 and 3 start when Bet 1 lands; they overlap. Bet 4 waits for 2 + 3 because MCP clients need the structured agent surface and gateway doesn't want to lock to one LLM.

## Updating

When a bet changes materially (new deliverable, scope cut, kill criterion tripped), update the brief file in this directory as the source of truth and link the PR from the tracking issue. Don't let the briefs drift from reality.
