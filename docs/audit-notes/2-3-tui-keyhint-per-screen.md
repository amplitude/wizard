# Audit 2.3 — Plumb per-screen hints

**Category:** TUI
**Effort:** M
**Status:** Implemented.

## What changed

Added `src/ui/tui/hooks/useScreenHints.ts` — a module-scoped nanostore atom
plus a `useScreenHints(hints)` register hook and `useScreenHintsValue()`
subscription hook. Since only one screen is active at a time, a single
atom is sufficient and avoids threading props through the router + App
shell.

`ConsoleView` now prefers the registered hints over the legacy
`screenHints` prop (still accepted for backward compatibility). When a
screen unmounts the hook clears its registration, preventing stale hints
from bleeding into the next screen.

Wired up three high-traffic screens:

- `IntroScreen` — ↑↓ Navigate / Enter Select
- `RegionSelectScreen` — ↑↓ Navigate / Enter Select
- `RunScreen` — ←→ Tabs / Ctrl+C Cancel

Remaining screens continue to render just the default `/` (Commands) and
`Tab` (Ask a question) hints. Screens without explicit hints produce the
same output as before this change — no regressions.

## Follow-ups

- Wire the remaining 13 screens. Most map to ↑↓/Enter patterns via
  `PickerMenu`; `SlackScreen` / `McpScreen` have their own key handlers.
