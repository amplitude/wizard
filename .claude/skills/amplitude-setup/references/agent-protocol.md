# Amplitude Wizard — agent NDJSON protocol

This is a quick reference for the events the wizard emits in `--agent` mode
(or whenever stdout is not a TTY and `--json` is implied). Every event is one
line of NDJSON on stdout, sharing this envelope:

```json
{
  "v": 1,
  "@timestamp": "2026-04-29T22:02:46.456Z",
  "type": "<event-type>",
  "message": "<short human-readable summary>",
  "session_id": "<uuid>",
  "run_id": "<uuid>",
  "level": "info | warn | error | success | step",
  "data_version": 1,
  "data": { "event": "<discriminator>", ... }
}
```

The `data.event` field is the discriminator inside `data` — branch on
`(type, data.event, data_version)` rather than envelope `v` alone.

## Event types

| `type`           | When                                                                     |
| ---------------- | ------------------------------------------------------------------------ |
| `lifecycle`      | Phase boundaries (`intro`, `start_run`, `apply_started`, `setup_context`, `run_completed`). |
| `log`            | Free-form info / warn / error / success / step messages. Capped at 2KB.  |
| `status`         | Spinner / heartbeat updates (ephemeral).                                 |
| `progress`       | Inner-agent activity (`tool_call`, `file_change_planned`, `todos`).      |
| `session_state`  | `setCredentials`, `setRegion`, `setDetectedFramework`, etc.              |
| `prompt`         | Legacy — kept for back-compat. Prefer `needs_input`.                     |
| `needs_input`    | Wizard wants an answer. Exits with code 12 (`INPUT_REQUIRED`).           |
| `diagnostic`     | Retries, service degradations, recoverable warnings.                     |
| `result`         | Concrete artifacts (`event_plan_set`, `dashboard_created`, `setup_complete`, `file_change_applied`). |
| `error`          | Failure paths (`apply_failed`, `auth_required`, exceptions).             |

## Key `data.event` discriminators

### `setup_context` (NEW)

Emitted at known phase boundaries before any writes. Carries the resolved
Amplitude scope so the orchestrator can show the user "you're about to
modify org/project/app/env" before they confirm. Emitted from:

- `wizard plan` — `phase: "plan"`. Has org/region from auth, no app yet.
- `wizard apply` — `phase: "apply_started"`. Same scope as plan, plus any
  `--app-id` flag the agent passed.
- (future) inner agent emits one more `phase: "apply_started"` once env
  resolution completes inside the spawned child.

```json
{
  "type": "lifecycle",
  "data_version": 1,
  "data": {
    "event": "setup_context",
    "phase": "apply_started",
    "amplitude": {
      "region": "us",
      "orgId": "abc",
      "orgName": "Acme",
      "projectId": "def",
      "projectName": "Marketing Site",
      "appId": "769610"
    },
    "sources": { "region": "saved", "orgId": "saved", "appId": "flag" },
    "requiresConfirmation": false,
    "resumeFlags": {
      "changeApp": ["apply", "--plan-id", "<id>", "--app-id", "<id>", "--yes"]
    }
  }
}
```

`requiresConfirmation: true` means the orchestrator MUST surface this
scope to the user before proceeding. `sources` per-field: `auto`,
`flag`, `saved`, or `recommended` — render as a badge so the user knows
where each value came from.

### `setup_complete` (NEW)

Terminal artifact event, emitted exactly once before `run_completed` on a
successful run. Skill rule: replace any cached project context with
`amplitude.appId` for any follow-up Amplitude MCP queries.

```json
{
  "type": "result",
  "level": "success",
  "data_version": 1,
  "data": {
    "event": "setup_complete",
    "amplitude": {
      "region": "us",
      "orgId": "abc",
      "orgName": "Acme",
      "projectId": "def",
      "projectName": "Marketing Site",
      "appId": "769610",
      "appName": "TodoMVC",
      "envName": "Production",
      "dashboardUrl": "https://app.amplitude.com/analytics/acme/dashboard/l3woxmga",
      "dashboardId": "l3woxmga"
    },
    "files": {
      "written": ["/path/to/src/amplitude.js"],
      "modified": ["/path/to/src/index.js", "/path/to/src/header.jsx"]
    },
    "events": [
      { "name": "Todo Created", "description": "User submits a new todo." }
    ],
    "durationMs": 108523
  }
}
```

### `needs_input`

Wizard exits with code 12 and waits for re-invocation. The `choices[]`
each carry a `resumeFlags` argv array — re-run with those flags to resolve
the prompt. Skill MUST surface to the user; never silently pick `recommended`.

```json
{
  "type": "needs_input",
  "data": {
    "event": "needs_input",
    "code": "event_plan",
    "ui": { "component": "confirmation", "priority": "required", "title": "Approve instrumentation plan" },
    "choices": [
      { "value": "approved", "label": "Approve and instrument",
        "resumeFlags": ["apply", "--plan-id", "<id>", "--approve-events", "--yes"] },
      { "value": "skipped",  "label": "Skip event tracking for this run",
        "resumeFlags": ["apply", "--plan-id", "<id>", "--skip-events", "--yes"] },
      { "value": "revised",  "label": "Send revision feedback",
        "resumeFlags": ["apply", "--plan-id", "<id>", "--revise-events", "<feedback>", "--yes"] }
    ],
    "recommended": "approved"
  }
}
```

### `diagnostic / kind: retry`

Inner agent hit a transient API error and is retrying. Skill MUST render
this so the user sees why the wizard paused.

```json
{
  "type": "diagnostic",
  "data": { "kind": "retry", "attempt": 2, "maxRetries": 6, "errorStatus": 400 }
}
```

A subsequent `kind: retry_cleared` means the retry succeeded.

### `run_completed`

Terminal lifecycle event. Absence before stream EOF means the wizard
crashed. `outcome: "success"` with `exitCode: 0` is the only signal of a
clean run.

```json
{
  "type": "lifecycle",
  "data": { "event": "run_completed", "outcome": "success", "exitCode": 0, "durationMs": 108600 }
}
```

## Exit codes

| Code | Constant            | Action                                                                                   |
| ---- | ------------------- | ---------------------------------------------------------------------------------------- |
| 0    | `SUCCESS`           | Read `setup_complete` for artifacts.                                                     |
| 3    | `AUTH_REQUIRED`     | User must run `wizard login` (browser OAuth). Re-run after.                              |
| 12   | `INPUT_REQUIRED`    | Last `needs_input` is the question. Re-invoke with `resumeFlags`.                        |
| 13   | `WRITE_REFUSED`     | Re-run with `--yes` (writes) or `--force` (overwrite existing files).                    |
| 130  | `USER_CANCELLED`    | User pressed Ctrl+C or the wizard aborted on their behalf.                               |

Other non-zero codes are general failures — surface the last `type: error`
event's `message` and ask the user to share `~/.amplitude/wizard/runs/<run_id>/log.txt`.
