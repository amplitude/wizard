# Audit 6.1 — Screen error boundary diagnostic

**Category:** TUI
**Effort:** S
**Status:** Implemented.

## What changed

`ScreenErrorBoundary.componentDidCatch()` now captures the React
`componentStack` and dumps a full redacted diagnostic snapshot
(`createDiagnosticSnapshot`) both to:

- `stderr` — for in-terminal copy/paste when users report a crash
- the wizard log file (`logToFile`) — for post-mortem via
  `/tmp/amplitude-wizard.log`

Stdout is intentionally left alone so NDJSON / machine consumers are
unaffected. All diagnostic work is wrapped in try/catch so the boundary
itself never bubbles a secondary error.
