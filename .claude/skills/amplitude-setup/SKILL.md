---
name: amplitude-setup
description: Set up Amplitude analytics in this codebase using the Amplitude Wizard agent contract. Use whenever a user asks to install Amplitude, instrument analytics events, configure Amplitude SDK, connect this app to Amplitude, or wire up tracking with @amplitude/wizard.
metadata:
  author: Amplitude
  version: '1.0.0'
---

# Amplitude Wizard — Agent Setup

You are driving `@amplitude/wizard` (the npm CLI) to set up Amplitude analytics
in the user's codebase. Follow this protocol exactly. The wizard's NDJSON
contract emits structured events on stdout — your job is to read them, surface
the user-relevant ones, and stop for explicit user confirmation before any
file or Amplitude project is modified.

## Protocol — non-negotiables

1. **Never run `npx @amplitude/wizard` (the bare interactive entrypoint).** It
   assumes a TTY and a human at the keyboard. Always use the subcommands below.
2. **Never run `apply` in the background.** Run it in the foreground so its
   NDJSON streams through your tool output in real time. Backgrounding it
   forces you to poll a tail file with `sleep && tail`, which adds minutes of
   latency between each progress update.
3. **NEVER spawn a second `apply` while one is already running.** If a previous
   `apply` invocation is still streaming events on stdout, do NOT start
   another. Each apply spawns an inner Claude SDK agent that writes files;
   two of them stomp each other's edits and produce contradictory `setup_complete`
   payloads. Wait for the current run's `run_completed` event before any retry.
4. **Always pass `--confirm-app`** when running `plan` or `apply`. This forces
   the wizard to ask which Amplitude app to write into instead of silently
   picking the first one it finds.
5. **Always pass `--install-dir <abs-path>` and confirm it's a real project.**
   If the user invokes the wizard from their home directory, a multi-project
   parent (`~/dev/`, `~/code/`, etc.), or any directory without a clear
   project marker (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`,
   `Gemfile`, `pom.xml`, `build.gradle`), STOP and ask the user which
   project to set up. Do not guess.
6. **Never auto-approve the event plan.** When you see `type: needs_input` with
   `code: event_plan`, STOP. Show the proposed events to the user. Re-invoke
   `apply` with `--approve-events`, `--skip-events`, or
   `--revise-events "<feedback>"` based on their answer.
7. **Always render `type: diagnostic` events** as user-visible status.
   Transient retries should look like `⚠ retrying (2/6)...`, not silent gaps.
8. **After `setup_complete`, lock your project context to `amplitude.appId`.**
   Use only that app id for follow-up Amplitude MCP queries (charts, dashboards,
   events). Do not reuse any project context cached earlier in the session.
9. **Wizard-managed artifacts are owned by the wizard.** Do NOT use `Write` /
   `Edit` on `.amplitude/events.json`, `.amplitude/dashboard.json`,
   `.amplitude-events.json`, or `.amplitude-dashboard.json`. The wizard's
   `confirm_event_plan` MCP tool persists the events file in the canonical
   shape; the dashboard watcher mirrors the dashboard JSON. Direct writes
   are denied by the inner-agent permission hook with a clear error
   message — if you see that deny, switch to the MCP tool.

## Step 1 — preflight (cheap, no writes)

Run all three in parallel; they're fast and read-only:

```
npx @amplitude/wizard whoami --json
npx @amplitude/wizard detect --json
npx @amplitude/wizard status --json
```

Tell the user, in one sentence, what you found:

> Auth: `<email>` (Org: `<orgName>`, Region: `<region>`)
> Framework: `<frameworkName>` detected at `<install-dir>`

If `whoami.loggedIn === false`: stop and ask the user to run
`npx @amplitude/wizard login` in their terminal (browser OAuth — agents
cannot drive it). After they confirm "logged in", re-run `whoami --json` to
verify.

## Step 2 — plan (no writes; read-only)

```
npx @amplitude/wizard plan --confirm-app --json --install-dir <abs-path>
```

The output stream contains, in order:

1. `type: lifecycle, data.event: setup_context, phase: plan` — the resolved
   Amplitude scope (region, org, project). **Show this to the user.**
2. `type: plan, data.event: plan` — the `planId`, framework, SDK package,
   and proposed events.

Render the proposed events as a short bulleted list with one line each. Ask
the user:

> "I'll instrument these N events. Approve, revise, or skip?
> Reply 'approve', 'revise: <feedback>', or 'skip'."

Capture the planId — you need it for `apply`.

## Step 3 — apply (foreground, NDJSON streamed)

Pick exactly one of these based on the user's reply:

```
npx @amplitude/wizard apply --plan-id <planId> --confirm-app --approve-events --yes --json
npx @amplitude/wizard apply --plan-id <planId> --confirm-app --skip-events --yes --json
npx @amplitude/wizard apply --plan-id <planId> --confirm-app --revise-events "<feedback>" --yes --json
```

Do NOT background this. Stream the NDJSON live and surface events to the user
as they arrive. Translate each event type into one short status line:

| Event                                         | Render                                       |
| --------------------------------------------- | -------------------------------------------- |
| `lifecycle / setup_context (apply_started)`   | "Setting up app `<orgName> / <appName>`..."  |
| `lifecycle / inner_agent_started`             | "Agent online."                              |
| `progress / tool_call`                        | (Skip — too noisy. Show only in verbose.)    |
| `progress / file_change_planned`              | "✏️  Planning change: `<path>`"              |
| `result / file_change_applied`                | "✓ Wrote `<path>`"                           |
| `status / spinner / kind: heartbeat`          | (Skip; render the latest status line only.) |
| `diagnostic / kind: retry`                    | "⚠ Retrying (`<attempt>`/`<max>`)..."        |
| `diagnostic / kind: retry_cleared`            | "✓ Recovered."                              |
| `result / event_plan` (decision: …)           | "✓ Event plan: `<decision>`"                |
| `result / dashboard_created`                  | "✓ Dashboard: `<dashboardUrl>`"             |
| `needs_input / code: app_selection`           | STOP — see "Handling needs_input" below.     |
| `needs_input / code: event_plan`              | STOP — see "Handling needs_input" below.     |

## Step 4 — capture `setup_complete`

When you see `type: result, data.event: setup_complete`, this is the
authoritative artifact list. Pin these values for the rest of the session:

- `amplitude.appId` — the ONLY project handle to use for follow-up Amplitude
  MCP queries. Disregard any earlier project context.
- `amplitude.dashboardUrl` — show this as a clickable link to the user.
- `files.written / files.modified` — summarize so the user knows what changed.
- `events` — final approved list of analytics events the wizard wired up.

The wizard also persists this scope to `ampli.json` in the install dir
(`AppId`, `OrgId`, `ProjectId`, `EnvName`, `DashboardUrl`, `DashboardId`) so
future agent sessions can recover it without re-running setup.

After `setup_complete`, you should see exactly one
`type: lifecycle, data.event: run_completed` with `outcome: success` and
`exitCode: 0`. Absence of `run_completed` before stream EOF means the wizard
crashed — surface a generic failure and ask the user to share
`~/.amplitude/wizard/runs/<run_id>/log.txt`.

## Handling `needs_input`

When `type: needs_input` arrives, the wizard has exited with code **12
(INPUT_REQUIRED)** and is waiting for you to re-invoke. Do NOT pick the
`recommended` value silently. Show the user the question + choices, get an
answer, then re-invoke `apply` with the appropriate `resumeFlags` from the
event payload (or compose them yourself):

| code                      | Re-invoke flags                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `event_plan`              | `--approve-events` / `--skip-events` / `--revise-events "<text>"`                    |
| `environment_selection`   | `--app-id <id>` (use the `appId` field from the chosen `choices[]` entry)             |
| `app_selection`           | `--app-id <id>`                                                                       |
| `confirm`                 | re-run with `--yes` (writes) or `--auto-approve` (no writes), per the choice          |
| destructive overwrite     | `--force` (only after the user confirms they're OK overwriting)                       |

For any other `code` you don't recognize, surface the `message` and `choices`
verbatim and let the user pick. Each choice carries `resumeFlags` for its
own re-invocation — use those rather than composing your own.

## Recovery

| Exit code | Meaning              | Action                                                                                                |
| --------- | -------------------- | ----------------------------------------------------------------------------------------------------- |
| `0`       | Success              | Use `setup_complete` payload.                                                                         |
| `3`       | `AUTH_REQUIRED`      | Tell the user to run `npx @amplitude/wizard login`. Re-run `whoami --json` to confirm before retry.   |
| `12`      | `INPUT_REQUIRED`     | Surface the last `needs_input`. Re-invoke with `resumeFlags`.                                         |
| `13`      | `WRITE_REFUSED`      | Confirm with the user, then re-invoke with `--yes` (or `--force` for overwriting existing files).     |
| anything else | failure          | Show the last `error` event's `message`. Don't retry blindly.                                         |

## What to NEVER do

- Do not background `apply`. Run it in foreground so events stream live.
- Do not spawn a second `apply` while one is running. Wait for `run_completed`.
- Do not auto-pick an Amplitude app, even when there's only one match. Always
  pass `--confirm-app` and surface the `setup_context` to the user.
- Do not silently approve the event plan. The user's analytics taxonomy is
  their decision, not yours.
- Do not assume an existing project context. After `setup_complete`, the
  authoritative `appId` is the one in that event — replace any earlier value.
- Do not log raw NDJSON lines to the user. Translate each event into a
  one-line status using the table above.
- Do not run the wizard from the user's home directory or a multi-project
  parent dir without explicit `--install-dir`. Confirm the project first.
- Do not `Write` or `Edit` `.amplitude/events.json`, `.amplitude/dashboard.json`,
  `.amplitude-events.json`, or `.amplitude-dashboard.json`. They are owned
  by the wizard's MCP tools.

## Starting fresh — `wizard reset`

If a previous wizard run left artifacts that no longer match the user's
intent (stale event plan, wrong dashboard, instrumented for the wrong
Amplitude app), run:

```
npx @amplitude/wizard reset --install-dir <abs-path> --json
```

This deletes `.amplitude/`, the legacy `.amplitude-*.json` dotfiles, and
`amplitude-setup-report.md` from the project, and strips auth-scoped
fields (`OrgId`, `AppId`, `AppName`, `EnvName`, `DashboardUrl`,
`DashboardId`) from `ampli.json`. It does NOT log the user out and does
NOT remove any `track()` calls already wired into source code — the
user has to revert those manually if they want a true blank slate
(`git checkout` is the safe path; `wizard reset` won't touch your code).

When to suggest `reset`:

- Previous run targeted the wrong Amplitude app.
- User wants to switch from one Amplitude org to another.
- The proposed event plan no longer fits the codebase (UI changed, new
  flows added).

When NOT to suggest `reset`:

- The wizard is mid-run. Wait for `run_completed`.
- The user just wants to add more events. Re-running `plan` + `apply`
  is enough; the wizard supplements the existing plan rather than
  replacing it.

## Quick reference (full command shape)

```
# Probe + plan, in parallel
npx @amplitude/wizard whoami --json
npx @amplitude/wizard detect --json --install-dir <dir>
npx @amplitude/wizard plan --confirm-app --json --install-dir <dir>

# Apply (pick exactly one event-plan flag)
npx @amplitude/wizard apply \
  --plan-id <id> \
  --confirm-app \
  --approve-events \
  --yes --json \
  --install-dir <dir>

# Resumes after needs_input
npx @amplitude/wizard apply --plan-id <id> --app-id <id> --approve-events --yes --json
```

See `references/agent-protocol.md` (in this skill) for the full NDJSON event
catalog and `references/example-session.jsonl` for a worked happy-path
session.
