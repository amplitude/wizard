# Audit C5 — Replace console.log with getUI

**Category:** CLI
**Effort:** M
**Status:** Implemented.

## What changed

All remaining `console.log` / `console.error` call sites in `bin.ts`
(outside of the agent-runner boundary) now route through `getUI()`:

- Login / logout / whoami / feedback / region / detect / status /
  auth status / auth token paths
- TUI init fallback debug output
- OAuth setup debug output

This keeps user-facing output consistent across interactive (`LoggingUI`),
TUI (`InkUI`), and NDJSON (`AgentUI`) modes — especially so that
`--agent` consumers see structured events for command output instead of
raw stdout bytes.

Non-UI writes kept:
- `process.stdout.write(JSON.stringify(...))` — explicit JSON output for
  machine consumers (`--json` / `detect`, `status`, `auth`).
- `process.stdout.write(result.token + '\n')` — raw token output for
  shell substitution (`$(amplitude-wizard auth token)`).
