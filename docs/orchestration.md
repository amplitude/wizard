# Orchestration store (v2 foundation)

> **Status:** PR 1 of 3. This document describes the durable orchestration
> surface introduced in `src/lib/orchestration/`. The TUI redesign (PR 3)
> and the user-choice / verification / MCP-app lifecycle (PR 2) layer on
> top of this foundation.

## Why

The wizard's `WizardSession` (`src/lib/wizard-session.ts`) is the de-facto
orchestration surface, but it is an **in-memory** snapshot held in a single
process. Outer agents that wrap the wizard (Claude Code, Cursor, custom
orchestrators) have no durable, machine-readable view of "what's running,
what stopped, what's the resume command." They scrape TUI text or grep
`log.ndjson`. Status JSON exists for a few specific commands (`wizard
status`, `wizard projects list`) but each shape is ad-hoc — there is no
unified envelope.

The v2 foundation adds a single durable store that becomes the source of
truth for:

- **Sessions** — multiple per machine, scoped per install dir.
- **Tasks** — explicit lifecycle (`queued / running / waiting_for_user /
  blocked / completed / failed / cancelled / superseded`) with a transition
  validator that throws on illegal moves.
- **Subagents** — typed wrappers around tasks with parent / child links.
- **Ownership** — which task currently owns which branch / worktree / PR.
- **Last-stopping-point** — derived snapshot ("what should I do next?").
- **Structured task results** — Zod-typed.

## State model

```
                 ┌────────────────────────────────────────┐
                 │             Session                    │
                 │  id, installDir, status, goal, branch  │
                 └─────────────┬──────────────────────────┘
                               │ 1..n
                               ▼
                 ┌────────────────────────────────────────┐
                 │              Task                      │
                 │ id, sessionId, parentTaskId,           │
                 │ label, state, ownership[], result      │
                 └─────────┬───────────────────┬──────────┘
                           │ 1..n              │ 1..n
                           ▼                   ▼
            ┌──────────────────────┐  ┌──────────────────┐
            │      Subagent         │  │   Ownership      │
            │ kind, rootTaskId      │  │ kind, …          │
            └──────────────────────┘  └──────────────────┘
```

## Lifecycle

```
  ┌──────────┐        ┌──────────┐        ┌────────────┐
  │  queued  │──────► │ running  │──────► │ completed  │ (terminal)
  └──────────┘        └────┬─────┘        └────────────┘
       │                   ├──► waiting_for_user ◄──┐
       │                   │           │            │
       │                   ├──► blocked ◄───────────┤
       │                   │                        │
       └─► cancelled       └──► failed              │
                                                    │
   any non-terminal  ──────► superseded             │
                                          (─────────┘ from waiting/blocked)
```

Implemented in [`src/lib/orchestration/lifecycle.ts`](../src/lib/orchestration/lifecycle.ts).
The `assertTransition(taskId, from, to)` helper is the trust boundary; the
store invokes it before mutating, so an illegal transition surfaces as a
thrown `IllegalTaskTransitionError` rather than corrupt persisted state.

## Storage layout

Single JSON file per install dir, co-located with the existing per-project
run dir:

```
~/.amplitude/wizard/runs/<sha256(installDir)>/orchestration.json
```

This is the same `runs/<hash>/` directory that already holds `log.txt`,
`log.ndjson`, and `checkpoint.json`. Two parallel wizard runs in different
install dirs can't collide; a single `rm -rf <runDir>` wipes every wizard
side-effect for that install dir, including orchestration state.

The file is written via `atomicWriteJSON` (temp-file + rename) at mode
`0o600`. Crash-safe: a process that dies mid-write leaves the prior
on-disk file untouched. Cross-process concurrency is **last-writer-wins**
under the existing "single active wizard per install dir" assumption that
`apply.lock` already enforces.

## Schemas

All persisted shapes have a runtime Zod validator in
[`src/lib/orchestration/schemas.ts`](../src/lib/orchestration/schemas.ts).
Every CLI handler validates its `--json` payload against the relevant
envelope schema **before** writing to stdout, so a regression in the
producer surfaces as a thrown ZodError on the producer side rather than
a silent corruption of the orchestrator-facing API.

The on-disk envelope carries an explicit `version: 1` literal. A
version-mismatched file returns `kind: 'corrupt'` from `loadStore` so
readers can distinguish "no store yet" from "found a store but couldn't
parse it" and surface a useful message.

## CLI

| Command | Purpose |
|---------|---------|
| `wizard tasks` | List every task in the store. Filter with `--state`, `--session-id`. |
| `wizard task <id>` | Inspect a single task. |
| `wizard sessions` | List every session in the store. |
| `wizard session <id>` | Inspect a session and its tasks. |
| `wizard resume <session-id>` | Print (or run with `--execute`) the resume command. |
| `wizard orchestration status` | Print the `LastStoppingPoint` snapshot. |

`--json` is auto-enabled when stdout is not a TTY (matches the existing
wizard convention). Pass `--human` to force the human-readable path even
when piped.

### Example human output

```
$ amplitude-wizard orchestration status
Store: /Users/me/.amplitude/wizard/runs/3d8f2a1b9c4e/orchestration.json (generated 2026-05-09T12:34:56.789Z)
Active session: session_a3f9e7c2d1b48a09f5c6
Goal:           set up Amplitude in nextjs
Branch:         feat/amplitude-setup
Active tasks:           1
Stopped tasks (24h):    0
Recently completed:     2

Next action: A task is waiting for user input: review the proposed events.json.
Resume:      amplitude-wizard --install-dir /Users/me/myapp
```

### Example JSON output

```json
{
  "v": 1,
  "type": "orchestration_status",
  "generatedAt": "2026-05-09T12:34:56.789Z",
  "installDir": "/Users/me/myapp",
  "storePath": "/Users/me/.amplitude/wizard/runs/3d8f2a1b9c4e/orchestration.json",
  "storeExists": true,
  "lastStoppingPoint": {
    "generatedAt": 1715258096789,
    "currentSessionId": "session_a3f9e7c2d1b48a09f5c6",
    "currentGoal": "set up Amplitude in nextjs",
    "currentBranch": "feat/amplitude-setup",
    "currentWorktree": "/Users/me/myapp",
    "activeTasks": [
      {
        "id": "task_b1c2d3e4f5a6b7c8d9e0",
        "sessionId": "session_a3f9e7c2d1b48a09f5c6",
        "label": "event plan confirmation",
        "state": "waiting_for_user",
        "ownership": [],
        "subagentKind": "instrumentation",
        "createdAt": 1715258090000,
        "updatedAt": 1715258091000,
        "startedAt": 1715258090500,
        "waitingFor": {
          "id": "cp_event_plan",
          "kind": "event_plan_confirm",
          "summary": "review the proposed events.json",
          "enteredAt": 1715258091000
        }
      }
    ],
    "stoppedTasks": [],
    "recentlyCompletedTasks": [],
    "relevantOwnership": [],
    "pendingChoices": [
      {
        "id": "cp_event_plan",
        "kind": "event_plan_confirm",
        "summary": "review the proposed events.json",
        "enteredAt": 1715258091000
      }
    ],
    "pendingMcpActions": [],
    "pendingManualVerifications": [],
    "nextAction": {
      "kind": "await_user_choice",
      "description": "A task is waiting for user input: review the proposed events.json.",
      "command": ["amplitude-wizard", "--install-dir", "/Users/me/myapp"]
    },
    "resumeCommand": "amplitude-wizard --install-dir /Users/me/myapp"
  }
}
```

## Exit codes

The orchestration commands inherit the wizard's existing exit-code
contract, summarised in [`docs/exit-codes.md`](./exit-codes.md):

| Code | Meaning |
|------|---------|
| 0 | success |
| 1 | general / unexpected error |
| 2 | invalid argument (bad lifecycle filter, missing id, malformed prefix) |
| 130 | user cancelled (SIGINT) |

## Performance / cost

Each task transition triggers ≤ 1 atomic write of a small JSON file. A
typical wizard run touches a few hundred transitions; the orchestration
file therefore stays well under the I/O budget the wizard already spends
on `runs/<hash>/log.ndjson` writes. PR 3 will add a debounced in-memory
cache for the eventual high-frequency call sites.

## Migration plan (PR 1 → PR 3)

PR 1 keeps both the legacy `WizardSession` AND the new `OrchestrationStore`
live. The store is **mirrored** from a single high-leverage hook
(session-start in `src/run.ts`) — every other call site continues to use
the in-memory `WizardSession` snapshot. This is intentional:

- **PR 1 (this PR)** — durable schema, lifecycle, store, status / tasks /
  sessions / resume CLI commands, last-stopping-point derivation.
  Foundation only.
- **PR 2** — widens `PendingCheckpoint` with concrete schemas, routes the
  existing user-choice / event-plan-confirm / MCP-app prompt sites through
  the store. `pendingChoices` / `pendingMcpActions` /
  `pendingManualVerifications` start carrying real content.
- **PR 3** — TUI v2 reads from the store as its source of truth (bidirectional
  sync via the existing nanostores reactive layer), retires duplicated
  state, surfaces the new MCP-server read-only tools so outer coding agents
  can call them as typed tools instead of parsing `wizard status` stdout.

## What's deliberately not in PR 1

- TUI integration. `src/ui/tui/` is unchanged.
- Wiring write paths beyond session-start. Most existing `tasks.push(...)`
  sites in `src/ui/tui/store.ts` and `src/lib/wizard-session.ts` keep
  using the legacy in-memory shape — PR 2 widens this.
- MCP-server read tools (`amplitude-wizard mcp serve`). The new store is
  ready for them but the tool surface lands in PR 3.
- Auto-migration of pre-existing state. The first wizard run after PR 1
  starts with an empty orchestration store; checkpoints from previous
  versions are unaffected.
