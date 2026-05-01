# `--agent` NDJSON Contract

The wizard's `--agent` mode emits one JSON line per significant moment to
stdout. Outer agents (Claude Code, Cursor, Codex, custom orchestrators) and
the e2e test harness consume that stream as the wizard's primary
machine-readable interface.

This document is the navigable reference. The TypeScript schema in
[`src/lib/agent-events.ts`](../src/lib/agent-events.ts) is the canonical
source of truth — when this doc and the code disagree, the code wins. The
sole writer is [`AgentUI`](../src/ui/agent-ui.ts).

## Why this is also the e2e test contract

[`docs/dual-mode-architecture.md`](./dual-mode-architecture.md) describes the
TUI / agent / CI split. The e2e harness relies on the same `--agent` stream
that orchestrators consume:

- **Deterministic by design.** No ANSI, no timing-dependent rendering, no
  Ink reconciliation. One event per line, JSON-parseable.
- **Already structured.** Every event carries a discriminator, a per-event
  `data_version`, and a sanitized payload. Tests assert on shape, not text.
- **Already covered by versioning.** The same schema rules that protect
  external orchestrators protect snapshot tests from accidental drift.
- **Already wired to the SDK seam.** `agent-interface.ts` routes through
  the [`AgentDriver`](../src/lib/agent-driver.ts) port; tests can swap a
  scripted driver and the rest of the runtime (hooks, classifier, NDJSON
  emission) executes unchanged.

The Phase 2 scenario harness (Promptfoo + scripted driver) and the Phase 1
snapshot tests both consume this stream. Treat any breaking change to the
schema as a breaking change to test infrastructure.

## Envelope

Every line is a JSON object matching `AgentEventEnvelope`:

```jsonc
{
  "v": 1,                          // Wire-format version. Bump on framing changes.
  "@timestamp": "2026-05-01T...Z", // ISO 8601 UTC. VOLATILE — redact in snapshots.
  "type": "lifecycle",             // One of AgentEventType (see below).
  "message": "Starting...",        // Free-form human-readable summary.
  "session_id": "...",             // Per-process correlation ID. VOLATILE.
  "run_id": "...",                 // Per-run correlation ID. VOLATILE.
  "level": "info",                 // Optional severity hint.
  "data_version": 1,               // Per-event-type data-shape version.
  "data": { /* event-specific shape */ }
}
```

### Stable vs volatile fields

| Field | Stability | Notes |
|---|---|---|
| `v` | Stable | Bumped only on breaking framing changes. |
| `@timestamp` | **Volatile** | ISO 8601, regenerated every emit. Redact for snapshots. |
| `type` | Stable | Closed set — see `AgentEventType`. |
| `message` | Semi-stable | Human prose; treat as informational. Don't regex it. |
| `session_id` | **Volatile** | UUID per process. Redact for snapshots. |
| `run_id` | **Volatile** | UUID per run. Redact for snapshots. |
| `level` | Stable | Closed set: `info` / `warn` / `error` / `success` / `step`. |
| `data_version` | Stable | Bumped only when the matching `data.event` shape breaks. |
| `data` | Stable | Per-`data.event` shape, governed by `data_version`. |
| `data.event` | Stable | Discriminator. Closed set per the registry. |

Tool-call IDs (forwarded from the SDK on `tool_call`) are also volatile and
should be redacted in snapshots — they're random per call and carry no
semantic value to the test.

## Versioning

There are two independent version axes. Bumping one does not bump the other.

1. **Envelope version `v`** (`AGENT_EVENT_WIRE_VERSION`). Today: `1`. Bump
   only when keys directly on the JSON line change shape.
2. **Per-event `data_version`** in `EVENT_DATA_VERSIONS`. Today: every
   registered event is at `1`. Bump when `data` for a single event
   discriminator breaks.

Orchestrators and tests should branch on the tuple `(type, data?.event,
data_version)`. Branching on envelope `v` alone is **insufficient** — that
field doesn't see changes inside `data`.

When you change a registered event's `data` shape:

1. Update the matching TypeScript interface in `agent-events.ts`.
2. Bump the entry in `EVENT_DATA_VERSIONS`.
3. Add a regression test pinning the new shape.
4. Update the consumer rows below if they reference the changed field.

When you add a new event:

1. Add the interface to `agent-events.ts`.
2. Add the discriminator to `EVENT_DATA_VERSIONS` at version `1`.
3. Wire emission through `AgentUI` (no other writers).
4. Document it below.

## Event types (`type` field)

The closed set defined by `AgentEventType`. Each event line carries exactly
one. The `data.event` discriminator further refines the meaning of
`lifecycle` / `result` / `error` events.

| `type` | Purpose | Discriminator | Stability |
|---|---|---|---|
| `lifecycle` | Run-spanning state transitions and inner-agent milestones | `data.event` | Stable |
| `log` | Free-form diagnostic. Truncated at 2KB. | None | Free-form |
| `status` | Short status pill text. Free-form. | None | Free-form |
| `progress` | Bounded progress notes (inc. heartbeat, file change planned). | `data.event` | Mostly stable |
| `session_state` | Snapshot of `WizardSession` for orchestrator mirroring. | None | Internal — don't depend |
| `prompt` | Human-facing prompt text being rendered (free-form). | None | Free-form |
| `needs_input` | Structured prompt awaiting orchestrator/human answer. | `data.event = 'needs_input'` | Stable |
| `diagnostic` | Diagnostic report dumps from the `/diagnostics` slash command. | None | Internal |
| `result` | Successful named outcomes (project create, file applied, dashboard...). | `data.event` | Stable |
| `error` | Run-failing error. Carries `recoverable` + `suggestedAction`. | `data.event` | Stable |

`log` and `error` `message` strings are truncated at `MAX_LOG_MESSAGE_LENGTH`
(2048 bytes). Other types carry bounded summaries by construction.

## Registered `data.event` discriminators

The full list from `EVENT_DATA_VERSIONS`. Source files for each interface
all live in `src/lib/agent-events.ts`.

### Lifecycle (`type: "lifecycle"`)

| Discriminator | Interface | Fires when |
|---|---|---|
| `start_run` | implicit | Wizard begins. |
| `intro` | implicit | Intro screen rendered. |
| `outro` | implicit | Outro screen rendered (any outcome). |
| `cancel` | implicit | User-driven cancel (e.g. `/exit`, Ctrl+C). |
| `auth_required` | inline | OAuth flow needed. Carries the login URL. |
| `nested_agent` | inline | Inner Claude agent run starting. |
| `inner_agent_started` | `InnerAgentStartedData` | SessionStart on the Claude SDK. |
| `project_create_start` | inline | Amplitude project create kicked off. |
| `project_create_success` | inline | Amplitude project create succeeded. |
| `project_create_error` | inline | Amplitude project create failed. |
| `setup_context` | `SetupContextData` | Before any work — the resolved Amplitude scope. |
| `setup_complete` | `SetupCompleteData` | Once per successful run, before `run_completed`. |
| `agent_metrics` | inline | Once per run at finalize — token / call counts. |
| `decision_auto` | inline | Wizard auto-picked a `needs_input` answer. |
| `checkpoint_saved` | inline | Wizard wrote a session checkpoint. |
| `checkpoint_loaded` | inline | Wizard restored from checkpoint at startup. |
| `checkpoint_cleared` | inline | Wizard cleared a checkpoint (success / manual / logout). |
| `run_completed` | `RunCompletedData` | Terminal — exactly once before `process.exit()`. |

### Progress (`type: "progress"`)

| Discriminator | Interface | Fires when |
|---|---|---|
| `tool_call` | `ToolCallData` | PreToolUse — every inner-agent tool call. |
| `file_change_planned` | `FileChangePlannedData` | PreToolUse for write tools. |
| `heartbeat` | inline | Every ~10s while the inner agent runs. |

### Result (`type: "result"`)

| Discriminator | Interface | Fires when |
|---|---|---|
| `file_change_applied` | `FileChangeAppliedData` | PostToolUse for successful write tools. |
| `event_plan_proposed` | `EventPlanProposedData` | Inner agent calls `confirm_event_plan`. |
| `event_plan_confirmed` | `EventPlanConfirmedData` | After the user/orchestrator decides on the plan. |
| `event_plan` | inline | The committed plan, post-approval. |
| `event_plan_set` | inline | Plan persisted to `<installDir>/.amplitude/events.json`. |
| `events_detected` | inline | Wizard discovered ingested events on the Amplitude side. |
| `verification_started` | `VerificationStartedData` | Post-apply verification phase started. |
| `verification_result` | `VerificationResultData` | Verification phase result. |
| `dashboard_created` | inline | Wizard created an Amplitude dashboard. |

### Needs input (`type: "needs_input"`)

| Discriminator | Interface |
|---|---|
| `needs_input` | `NeedsInputWireData` |

The most orchestrator-facing event in the wire. Always pairs with a
`decision_auto` follow-up when the wizard auto-resolves under
`--auto-approve` / `--yes` / `--ci` / `--agent` back-compat.

### Error (`type: "error"`)

Every error event carries `RecoverableErrorData`:

```jsonc
"data": {
  "event": "...",
  "recoverable": "retry" | "reinvoke_with_flag" | "human_required" | "fatal",
  "suggestedAction": { "command": [...], "docsUrl": "..." }
}
```

`classifyRunError(err)` maps an `Error` to the correct hint. See
`agent-events.ts` for the full pattern table.

## Ordering guarantees

The contract makes the following ordering promises:

1. `run_completed` fires **exactly once** per process and is the **last**
   event before `process.exit()`. Absence of `run_completed` before stream
   EOF means the wizard crashed.
2. `setup_context` fires **before** any `tool_call`, `file_change_planned`,
   or `file_change_applied`.
3. `setup_complete` fires **at most once** per run, **before**
   `run_completed`, and only on `outcome: "success"`.
4. Each `file_change_planned` is followed by a matching
   `file_change_applied` (same `path`) on success, or by an
   `error`/`run_completed` on failure.
5. Each `tool_call` PreToolUse precedes any tool result it produces.
6. `decision_auto` always fires **after** the matching `needs_input` it
   resolves, on the same stream.
7. `event_plan_proposed` precedes `event_plan_confirmed` for the same plan.
8. `heartbeat` fires every ~10s regardless of activity. **Absence** of
   `heartbeat` for >30s is the canonical "wizard stalled" signal.
9. `intro` precedes `outro`. Both fire at most once per run.

## Redaction (security invariants)

The emitter (`AgentUI`) is the only writer; redaction lives there. Per
`agent-events.ts`:

> Never include access tokens, API keys, refresh tokens, or full URLs
> containing query-string secrets in any payload.

Specific guarantees:

- `project_create_success` does NOT include the new project's API key —
  only `appId` and `name`.
- Resume hints (`resumeFlags`, `resumeCommand`) are argv arrays, never
  shell strings, so no escaping bugs can leak data.
- `setup_complete.envVars` carries names only (`{added: [...], modified:
  [...]}`), never values.
- `log` and `error` messages are truncated to 2048 bytes via
  `truncateLogMessage` — not a security primitive but bounds payload size
  for misbehaving callers.
- Tool inputs flow through `summarizeToolInput()` so file contents and
  large prompts never reach `tool_call.summary`.

If you find yourself adding a field that could carry a secret, redact at
the emit site, not at the consumer.

## Test-harness usage

### Snapshot tests (Phase 1)

NDJSON snapshots normalize volatile fields before diff. The redactor (lands
in Phase 1) replaces:

- `@timestamp` → `<TS>`
- `session_id`, `run_id` → `<UUID>`
- Tool-call IDs in `data.toolUseId` (when present) → `<TOOL_USE_ID>`
- File paths under the temp `installDir` → `<INSTALL_DIR>/...`
- Wall-clock durations (`durationMs`, `elapsedMs`) → `<DURATION>`

Snapshots are full-line JSON, sorted by emission order. A scenario that
emits N events produces N lines. Diff is line-based.

### Scenario tests (Phase 2)

Promptfoo's `claude-agent-sdk` provider exposes tool-call sequences. The
scripted `AgentDriver` (Phase 2) yields a canned message sequence so tests
assert on:

- Filesystem diff (real temp `installDir`).
- NDJSON event sequence (post-redaction).
- Final exit code (from `src/lib/exit-codes.ts`).
- Specific `data.event` discriminators in the right order.

The Promptfoo-native `trajectory:tool-used` / `trajectory:tool-sequence`
assertions map onto `tool_call` events.

### Property-based / metamorphic tests (later)

The deterministic shell of the wizard makes these tractable:

- Inserting irrelevant files into the `installDir` should not change the
  emitted event sequence.
- Renaming the project directory should not change the sequence.
- Reordering Next.js routes should produce the same set of `track()` calls
  (asserted on `setup_complete.events`).

## Adding a new event — checklist

1. Define the `data` interface in `agent-events.ts`.
2. Add the discriminator to `EVENT_DATA_VERSIONS` at version `1`.
3. Add the emitter method to `AgentUI` in `src/ui/agent-ui.ts` (only
   writer).
4. If the event is part of the orchestrator-facing contract, add a row to
   the table above.
5. If the event has ordering implications, document them in
   "Ordering guarantees" above.
6. Add at least one test that pins the wire shape.
7. Bump the per-event `data_version` on any subsequent breaking change —
   not the envelope `v`.
