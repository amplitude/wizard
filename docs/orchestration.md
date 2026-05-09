# Orchestration store (v2 foundation)

> **Status:** PR 2 of 3. PR 1 introduced the durable orchestration
> surface in `src/lib/orchestration/` (sessions, tasks, subagents,
> ownership, last-stopping-point). PR 2 (this) layers
> **user-choice checkpoints**, **manual-verification checkpoints**, and
> the **MCP-app capability lifecycle** on top of that foundation. The
> TUI redesign in PR 3 will read these typed records as its source of
> truth.

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

## PR 2: Choice checkpoints

A `Choice` is a discrete decision the wizard needs from a human (or, when
`automationAllowed === true`, from the orchestrator on the human's
behalf). Each Choice is a record on the orchestration store keyed by a
stable `promptId` so the same prompt is never asked twice
(`OrchestrationStore.findPendingChoice(promptId)` is the canonical
lookup).

### Schema

```ts
interface Choice {
  id: `choice_${string}`;
  kind:
    | 'environment_selection'
    | 'event_plan_approval'
    | 'event_plan_revision'
    | 'mcp_install'
    | 'mcp_auth'
    | 'slack_setup'
    | 'dashboard_setup'
    | 'data_ingestion_check'
    | 'keep_or_revert_files'
    | 'auth_retry'
    | 'manual_verification'
    | 'other';
  promptId: string;             // de-dup key
  message: string;
  options: Array<{ id; label; description?; isRecommended?; isSafestSkip?; consequence? }>;
  recommendedOptionId: string | null;
  safeDefaultOptionId: string | null;
  requiresHuman: boolean;       // automation MUST NOT pick when true
  automationAllowed: boolean;   // automation may pick safeDefaultOptionId on timeout
  timeoutBehavior: { ms?; action: 'pick_safe_default' | 'block' | 'fail' } | null;
  consequenceIfSkipped: string;
  reversible: boolean;
  whyAsking: string;
  status: 'pending' | 'answered' | 'expired' | 'cancelled' | 'superseded';
  answeredOptionId: string | null;
  answeredBy: 'human' | 'automation' | null;
  createdAt: string;            // ISO-8601
  answeredAt: string | null;
  expiresAt: string | null;
  resumeCommand: string[];
  linkedTaskId: `task_${string}` | null;
  linkedSessionId: `session_${string}`;
}
```

### Status transitions

```
  pending  ─►  answered     (terminal, except → superseded)
       │   ─►  expired      (terminal, except → superseded)
       │   ─►  cancelled    (terminal, except → superseded)
       └──►   superseded   (terminal)
```

### `requiresHuman` automation gate

`wizard choice answer <id> --option <opt>` REFUSES to act when
`requiresHuman === true` unless the operator passes
`--confirm-human`. This is the brief's "automation may not choose on
the user's behalf" requirement, enforced at the CLI boundary so an
automation that wires `wizard choice answer` directly cannot bypass it.

| Outcome | Exit code |
|---------|-----------|
| answered | 0 |
| invalid id format / unknown option | 2 |
| choice not found | 30 |
| choice not in pending status | 31 |
| `requiresHuman === true` and `--confirm-human` absent | 32 |

### Example payload (Choice)

```json
{
  "id": "choice_a3f9e7c2d1b48a09f5c6",
  "kind": "environment_selection",
  "promptId": "environment_selection:/Users/me/myapp",
  "message": "Select an Amplitude environment to send events to.",
  "options": [
    { "id": "769610", "label": "Amplitude / Production / prod" },
    { "id": "769611", "label": "Amplitude / Production / staging" }
  ],
  "recommendedOptionId": "769610",
  "safeDefaultOptionId": "769610",
  "requiresHuman": true,
  "automationAllowed": false,
  "timeoutBehavior": null,
  "consequenceIfSkipped": "Without an environment, the wizard cannot persist an API key or instrument any events.",
  "reversible": true,
  "whyAsking": "Multiple environments are available — wizard cannot infer which project the user wants to write to.",
  "status": "pending",
  "answeredOptionId": null,
  "answeredBy": null,
  "createdAt": "2026-05-09T12:00:00.000Z",
  "answeredAt": null,
  "expiresAt": null,
  "resumeCommand": ["amplitude-wizard", "--agent"],
  "linkedTaskId": null,
  "linkedSessionId": "session_b1c2d3e4f5a6b7c8d9e0"
}
```

### CLI

```
wizard choice list [--json] [--session-id <id>] [--status <pending|answered|expired|cancelled|superseded|all>]
wizard choice show <id> [--json]
wizard choice answer <id> --option <option-id> [--confirm-human]
```

Example human output:

```
$ wizard choice list
2 choice(s):
  choice_a3f9...  environment_selection  pending  Select an Amplitude environment to send events to.
    requires_human=true
  choice_b1c2...  event_plan_approval    pending  Approve the proposed event plan?
```

Example JSON envelope:

```json
{
  "v": 1,
  "type": "orchestration_choices",
  "generatedAt": "2026-05-09T12:34:56.789Z",
  "installDir": "/Users/me/myapp",
  "choices": [ /* Choice[] */ ]
}
```

## PR 2: Verification checkpoints

A `Verification` records a step a human must perform out-of-band before
the wizard can proceed. Examples: "open Amplitude UI and confirm events
are arriving", "review the proposed dashboard for correctness", "approve
the open PR and verify the deploy preview".

### Schema

```ts
interface Verification {
  id: `verif_${string}`;
  kind:
    | 'event_plan_review'
    | 'events_arriving_in_amplitude'
    | 'dashboard_correctness'
    | 'excalidraw_flow'
    | 'oauth_browser_login'
    | 'manual_pr_test'
    | 'other';
  whatToVerify: string;
  commandToRun: string[];     // optional argv
  expectedBehavior: string;
  status: 'pending' | 'passed' | 'failed' | 'skipped' | 'superseded';
  blockingTaskId: `task_${string}` | null;
  blockingPRNumber: number | null;
  blockingSessionId: `session_${string}`;
  unblockerHint: string | null;
  createdAt: string;          // ISO-8601
  completedAt: string | null;
  resumeCommand: string[];
}
```

### Status transitions

```
  pending  ─►  passed | failed | skipped | superseded
  failed   ─►  passed | superseded
  skipped  ─►  passed | failed | superseded
  passed   ─►  superseded   (a later flow invalidates the pass)
  superseded   (terminal)
```

### Example payload (Verification)

```json
{
  "id": "verif_c9d8e7f6a5b4c3d2e1f0",
  "kind": "events_arriving_in_amplitude",
  "whatToVerify": "Confirm Amplitude is receiving the 5 approved event(s) once the app emits them.",
  "commandToRun": [],
  "expectedBehavior": "In Amplitude, the events show up in the Live Event Stream within a minute of being fired client-side. None are blocked by ingestion filters.",
  "status": "pending",
  "blockingTaskId": null,
  "blockingPRNumber": null,
  "blockingSessionId": "session_b1c2d3e4f5a6b7c8d9e0",
  "unblockerHint": "If events do not arrive: re-check the API key, run `wizard verify`, and inspect the Live Event Stream filter chips for unintended drops.",
  "createdAt": "2026-05-09T12:34:56.789Z",
  "completedAt": null,
  "resumeCommand": ["wizard", "verification", "mark", "<id>", "--status", "passed"]
}
```

### CLI

```
wizard verification list [--json] [--session-id <id>] [--status <pending|passed|failed|skipped|superseded|all>]
wizard verification show <id> [--json]
wizard verification mark <id> --status <passed|failed|skipped>
```

| Outcome | Exit code |
|---------|-----------|
| marked successfully | 0 |
| invalid id format / bad status | 2 |
| verification not found | 33 |
| illegal status transition (e.g. `passed -> failed`) | 34 |

## PR 2: MCP-app capability lifecycle

A durable state machine for every MCP capability the wizard knows
about. Per-capability records are added on first contact and progress
through the legal-transitions graph below. The top-level commands and
TUI screens (PR 3) read these records as the source of truth for what
to ask the user, when, and how often.

### Schema

```ts
interface McpAppCapability {
  id: `mcp_${kind}_${string}`;
  kind:
    | 'claude_code_install'
    | 'cursor_install'
    | 'codex_install'
    | 'slack_app'
    | 'vscode_install'
    | 'github_app'
    | 'amplitude_mcp_http'
    | 'wizard_tools_inproc'
    | 'other';
  whyNeeded: string;
  whatItEnables: string;
  required: boolean;
  consequenceIfSkipped: string;
  safeToSkip: boolean;
  state:
    | 'unavailable'
    | 'available'
    | 'needs_auth'
    | 'needs_install'
    | 'needs_user_choice'
    | 'install_skipped'
    | 'installed'
    | 'failed'
    | 'not_applicable';
  userDecision: 'installed' | 'skipped' | 'pending' | null;
  userDecisionAt: string | null;
  userDecisionResumeCommand: string[];
  reversible: boolean;
  lastStateChangeAt: string;
  lastStateChangeReason: string | null;
  linkedTaskId: `task_${string}` | null;
  linkedSessionId: `session_${string}`;
}
```

### State transitions

```
  unavailable        ─►  available, not_applicable
  available          ─►  needs_auth, needs_install, needs_user_choice,
                          installed, failed, not_applicable
  needs_auth         ─►  available, needs_user_choice, needs_install,
                          installed, install_skipped, failed
  needs_install      ─►  needs_user_choice, installed, install_skipped, failed
  needs_user_choice  ─►  installed, install_skipped, failed, needs_auth
  install_skipped    ─►  needs_user_choice  (REQUIRES lastStateChangeReason),
                          installed         (operator re-installs out of band)
  installed          ─►  needs_auth, needs_install, failed, not_applicable
  failed             ─►  needs_user_choice, needs_install, needs_auth,
                          install_skipped, installed
  not_applicable     ─►  (terminal)
```

### Anti-nag invariant

The transition `install_skipped → needs_user_choice` requires the
caller to provide a non-empty `reason` argument to
`OrchestrationStore.transitionMcpCapability(id, newState, reason)`. The
validator throws `IllegalMcpTransitionError` with
`antiNagViolation === true` when the reason is missing or whitespace.

This exists because the wizard repeatedly bothered users about MCP
installs they had explicitly skipped — "skipped" was a negative space
(absence of a record) rather than an explicit state. The anti-nag rule
forces a deliberate, documented justification before re-prompting the
user (e.g. "skipped Slack later became required because the event plan
needs Slack notifications").

### Example payload (McpAppCapability)

```json
{
  "id": "mcp_claude_code_install_a3f9e7c2d1b48a09f5c6",
  "kind": "claude_code_install",
  "whyNeeded": "Claude Code can call wizard tools as typed MCP tools.",
  "whatItEnables": "Outer agent in Claude Code can call wizard ops without parsing CLI stdout.",
  "required": false,
  "consequenceIfSkipped": "Editor cannot call wizard tools — falls back to CLI parsing.",
  "safeToSkip": true,
  "state": "needs_user_choice",
  "userDecision": "pending",
  "userDecisionAt": null,
  "userDecisionResumeCommand": ["wizard", "mcp", "install", "claude_code"],
  "reversible": true,
  "lastStateChangeAt": "2026-05-09T12:34:56.789Z",
  "lastStateChangeReason": "User reached the MCP install screen.",
  "linkedTaskId": null,
  "linkedSessionId": "session_b1c2d3e4f5a6b7c8d9e0"
}
```

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

## What's deliberately not in PR 2

- TUI integration. `src/ui/tui/` is still unchanged. PR 3 will wire the
  Choice / Verification / McpAppCapability records into the relevant
  screens and the journey stepper.
- MCP-server tool surface. `src/lib/wizard-mcp-server.ts` does NOT yet
  expose `list_choices` / `list_manual_verifications` /
  `get_mcp_app_status`. The records exist on disk and the CLI surfaces
  them; PR 3 adds the typed MCP tools.
- Wiring beachhead is intentionally narrow. PR 2 instruments two
  callsites (env-selection in `src/commands/helpers.ts`, event-plan
  approval in `src/lib/wizard-tools.ts`) so the new state machines
  produce real data. PR 3 widens this to every active prompt site.
- Retiring legacy MCP-install state. The existing per-tool install
  logic in `src/steps/mcp-*` and `src/lib/wizard-tools.ts` keeps
  working untouched. PR 3 reads from the lifecycle as the source of
  truth and retires the duplicates.

## PR 3 — TUI integration + MCP tool parity + perf + resilience

### TUI integration model

PR 3 introduces a TUI overlay (`/status`) that renders the same data
`wizard orchestration status --json` emits, sectioned for human reading:

- Session, mode (interactive / agent / nested-agent)
- Active tasks, pending choices, pending verifications, MCP capabilities
- Owned branches / worktrees / PRs
- Recommended next action + resume command

The overlay is a passive render of the durable orchestration store —
every render pulls a fresh snapshot via the shared `envelopes.ts`
builders. There is no separate stream subscription, so the TUI cannot
drift out of sync with what `wizard orchestration status --json` would
report from another shell.

`StatusOverlayScreen` is wired into the existing `Overlay` enum and
slash-command dispatch so `/status` opens it from anywhere in the
wizard. Esc dismisses.

A bottom-of-screen `ManualVerificationRibbon` is mounted on `OutroScreen`
so success-looking UI cannot appear while a verification is still
pending — the resume command is rendered inline. `ChoiceCheckpointBanner`
is a reusable component (see `src/ui/tui/components/`) for surfacing a
typed `Choice` record on any screen with the full UX contract: why-asking,
recommended option, safe default, "skipping is/isn't safe", reversibility.

### Shared `envelopes.ts` layer

`src/lib/orchestration/envelopes.ts` centralizes every JSON shape the CLI
and the MCP server emit. Builders are pure (no I/O beyond reading the
store) and validate against the matching `*EnvelopeSchema` before
returning. CLI commands (`src/commands/orchestration.ts`,
`src/commands/choice.ts`, `src/commands/verification.ts`) and the MCP
server (`src/lib/wizard-mcp-server.ts`) call into the SAME builders, so
the two surfaces are byte-for-byte identical (modulo `generatedAt`).

A `withReadCache(fn)` helper amortises the cost of multiple builder
calls inside a single command/tool invocation: every builder called
inside the closure shares one parsed `OrchestrationStoreFile` instead of
re-reading the file from disk. The cache is per-call; the long-running
MCP server never sees stale state because it scopes a fresh cache key
to each tool call.

### MCP-server tool parity table

The external MCP server (`amplitude-wizard mcp serve`) now mirrors every
read-only orchestration CLI command as a typed MCP tool. Outer coding
agents can call these instead of shelling out to the CLI.

| CLI                                          | MCP tool                       |
|---------------------------------------------|-------------------------------|
| `wizard orchestration status --json`         | `get_orchestration_status`    |
| (subset)                                     | `get_last_stopping_point`     |
| `wizard tasks --json`                        | `list_tasks`                  |
| `wizard task <id> --json`                    | `get_task`                    |
| `wizard sessions --json`                     | `list_sessions`               |
| `wizard session <id> --json`                 | `get_session`                 |
| `wizard choice list --json`                  | `list_choices`                |
| `wizard choice show <id> --json`             | `get_choice`                  |
| `wizard verification list --json`            | `list_manual_verifications`   |
| `wizard verification show <id> --json`       | `get_manual_verification`     |
| (new)                                        | `list_mcp_capabilities`       |
| (new)                                        | `get_mcp_capability`          |

Mutations stay on the CLI by design — the MCP server is read-only.
Hosts that need to answer a Choice or mark a Verification spawn the
matching CLI subcommand (`wizard choice answer <id> --option <…>
--confirm-human`, `wizard verification mark <id> --status passed`).

### Performance hot-paths

PR 3 measures, then fixes, three perf items:

| Path                                       | Before                | After                | Mechanism |
|--------------------------------------------|-----------------------|----------------------|-----------|
| `buildStatusEnvelope` (empty store)        | ~6 ms                 | ~3-6 ms              | one-shot read; no redundant `.parse()` after the builder validates internally |
| 50× three-builder render of seeded store   | 3 reads / iter        | 1 read / iter        | per-invocation `OrchestrationStoreFile` cache |
| `gh pr view` repeated in same run          | up to 4× per run      | 1× per run           | `memoizeAsync` in `src/lib/per-run-cache.ts` |
| repeat MCP availability probe              | uncached              | cached per run id    | same `memoize` helper |

The wizard's full `wizard status --json` cold-start is still ~430 ms
on a typical dev box because Node + import overhead dominates. Bundling
the CLI with esbuild is the next obvious lever — deferred to a follow-up.

### Resilience — token-expired-during-long-task

When `agent-runner.ts` catches an `AUTH_ERROR` mid-stream, in addition to
setting the existing `outroData.preserveFiles` flag (which surfaces the
`[K] Keep / [R] Revert` UI in `OutroScreen`), the runner now also writes
to the orchestration store:

1. A pending `Choice` (kind = `keep_or_revert_files`, requiresHuman: true,
   recommended/safeDefault = `keep`).
2. A pending `Verification` (kind = `manual_pr_test`).
3. `wizard status --json` thereafter shows `lastStoppingPoint.nextAction.kind
   === 'await_user_choice'` plus the pending verification.

The `[K]/[R]` UI in `OutroScreen` continues to drive the user-facing flow;
the orchestration store records mirror that decision so an outer agent
inspecting the wizard's state after the fact (or another shell running
`wizard status --json`) sees a consistent picture.

`promptId` is keyed on the active session id so duplicate AUTH_ERROR
fires (very rare, but possible if the runner retries) don't pile up
multiple Choice records. The mirror is best-effort — a failure to write
to the orchestration store is logged but never breaks the existing
preserveFiles / abort flow.

### Anti-nag visibility in the TUI

The `/status` overlay surfaces every MCP capability in the store —
including `install_skipped` ones. The `lastStateChangeReason` is
rendered inline. The user can see at a glance "Amplitude MCP — skipped
(user-declined-on-prompt)" but never gets re-prompted, satisfying the
PR 2 anti-nag invariant.

### What's deliberately not in PR 3

- Full TUI redesign / information-architecture refactor. PR 3 lands the
  state-driven foundation. The screen-tree overhaul (single, unified
  context-aware view) is large enough to warrant its own effort.
- Widening the wiring beachhead beyond env-selection + event-plan-approval.
  Every other prompt site keeps its existing transient-screen-text path.
- Retiring `WizardSession`. The legacy in-memory session is still the
  source of truth for screen routing, journey state, and most session-
  scoped flags. Bridging the two stores is a follow-up.
- Bundling for cold-start. Node + import overhead is unchanged; future PR
  switches the CLI to an esbuild-bundled binary so cold-start drops below
  the brief's 200 ms target.
