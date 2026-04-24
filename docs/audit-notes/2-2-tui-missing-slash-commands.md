# Audit 2.2 — Add /debug /taxonomy /chart /dashboard

**Category:** TUI
**Effort:** M
**Status:** Implemented.

## What changed

Four new slash commands landed in the TUI ConsoleView:

- `/chart` — opens the "new chart" deep-link for the current org + zone
  (`OUTBOUND_URLS.newChart`).
- `/dashboard` — opens the "new dashboard" deep-link
  (`OUTBOUND_URLS.newDashboard`).
- `/taxonomy` — opens the Data Taxonomy editor for the current org at
  `{app}/{orgId}/data/taxonomy`.
- `/debug` — runs `createDiagnosticSnapshot()` and writes the full
  redacted snapshot to stderr for copy/paste sharing. A one-line summary
  lands in the console command feedback.

Added a small `openUrlInBrowser()` helper inside `ConsoleView.tsx` to
avoid pulling in the `open` npm dependency (it's not in the bundle —
`post-install-helpers.ts` uses the same `spawn` pattern).

All four commands degrade gracefully when offline / without an
authenticated session: the `/chart`, `/dashboard`, `/taxonomy` URLs work
unauthenticated (user lands on a sign-in page), and `/debug` doesn't
touch the network.

## Follow-ups

- Interactive overlays for `/chart` and `/dashboard` (e.g., inline
  wizard-style chart creation) remain in the Data Setup flow —
  `/chart`/`/dashboard` here just surface the creation UI.
- `/debug` should eventually accept `--copy` to push to clipboard; not
  implemented to keep the change minimal and dep-free.
