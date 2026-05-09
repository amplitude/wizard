# Exit codes

The wizard's exit-code surface is part of its public CLI contract.
Orchestrators script against these values; they are stable across minor
versions. The canonical enum lives in
[`src/lib/exit-codes.ts`](../src/lib/exit-codes.ts).

| Code | Symbol | Meaning |
|-----:|--------|---------|
| 0 | `SUCCESS` | clean exit |
| 1 | `GENERAL_ERROR` | catch-all "something went wrong" |
| 2 | `INVALID_ARGS` | unrecognised flag, malformed value, missing positional |
| 3 | `AUTH_REQUIRED` | wizard needs the user to (re-)authenticate |
| 4 | `NETWORK_ERROR` | network call failed (DNS, 5xx, transient) |
| 10 | `AGENT_FAILED` | inner Claude agent terminated with a real failure |
| 11 | `PROJECT_NAME_TAKEN` | `--project-name` collided with an existing project (non-interactive only) |
| 12 | `INPUT_REQUIRED` | agent-mode invocation needs an orchestrator decision |
| 13 | `WRITE_REFUSED` | agent attempted a write/destructive op without `allowWrites` / `allowDestructive` |
| 20 | `INTERNAL_ERROR` | wizard-side bug (uncaught exception, assertion violation) — distinct from `AGENT_FAILED` |
| 130 | `USER_CANCELLED` | SIGINT / Esc cancel |

## New v2 inspection commands

The orchestration inspection commands added by the v2 foundation
(`tasks`, `task <id>`, `sessions`, `session <id>`, `resume <session-id>`,
`orchestration status`) follow the same contract:

| Code | When |
|-----:|------|
| 0 | command succeeded; JSON envelope (or human output) emitted |
| 1 | unexpected error reading the store / serialising output |
| 2 | invalid args — bad `--state` value, malformed `task_<id>` / `session_<id>` prefix, unknown id |
| 130 | SIGINT during the command (rare for synchronous CLI) |

These commands are **read-only**. They never trigger auth flows, network
calls, or write the orchestration store, so codes 3 / 4 / 10 / 11 / 12 /
13 / 20 are not reachable.

## PR 2: choice + verification commands

The `wizard choice` and `wizard verification` subcommands extend the
namespace with a small set of operation-specific codes that live in
`src/commands/orchestration-exit-codes.ts`. Kept separate from the
top-level `ExitCode` enum so the global stable contract isn't broadened
for codes only the new sub-commands return.

| Code | Symbol | When |
|-----:|--------|------|
| 0 | `SUCCESS` | command succeeded |
| 1 | `GENERAL_ERROR` | unexpected error |
| 2 | `INVALID_ARGS` | bad id prefix, bad `--status` value, missing positional |
| 30 | `CHOICE_NOT_FOUND` | `wizard choice <show\|answer>` could not find the requested id |
| 31 | `CHOICE_NOT_PENDING` | `wizard choice answer` targeted a choice in `answered`/`expired`/`cancelled`/`superseded` |
| 32 | `CHOICE_REQUIRES_HUMAN` | choice has `requiresHuman === true` and operator did not pass `--confirm-human` (the brief's automation-gate) |
| 33 | `VERIFICATION_NOT_FOUND` | `wizard verification <show\|mark>` could not find the requested id |
| 34 | `VERIFICATION_INVALID_TRANSITION` | `wizard verification mark` targeted a status that's not legal from the current one (e.g. `passed → failed`) |

## Adding a new code

- Pick a value that doesn't collide with anything in `ExitCode`.
- The `exit-codes.test.ts` contract test asserts uniqueness — it'll catch
  accidental collisions on PR.
- Document the new code in this table AND in the JSDoc on the enum
  variant.
- Treat it as a stable public surface — orchestrators may already script
  against the integer.
