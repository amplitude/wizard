# Amplitude Wizard — Agent Instructions

## What this project is

An interactive CLI that instruments apps with Amplitude analytics. It authenticates the user, detects their framework, runs a Claude-powered agent to set up the SDK and events, and guides them through their first chart and dashboard.

The CLI behaves like Claude Code: a persistent prompt stays open throughout the session, and slash commands can be invoked at any time to change settings or trigger actions.

## Flows are the source of truth

The designed flows in [`docs/flows.md`](./docs/flows.md) define the intended user experience and should inform all implementation decisions. Before adding, changing, or removing any screen, step, or decision point, consult the flow diagrams. If you believe a flow needs to change, update `docs/flows.md` first and note it in your work.

The flows cover:

- **Wizard flow** — the main spine of the interactive TUI
- **Activation Check flow** — evaluates whether a returning user's project is ingesting events, and routes them accordingly
- **SUSI flow** — sign up / sign in, org and project selection for new users
- **Data Setup flow** — taxonomy agent, first chart, first dashboard checklist after events are ingested
- **Org / Project Selection flow** — picker UI for switching org or project, also used by `/org` and `/project` slash commands
- **Framework Detection flow** — auto-detect or manual selection, plus setup question disambiguation
- **Outro flow** — success, error, and cancel states after the agent run

## Architecture

- `bin.ts` — CLI entry point, yargs command definitions, mode flags
- `src/run.ts` — main wizard orchestration
- `src/ui/tui/` — Ink-based interactive TUI
  - `router.ts` — resolves the active screen from session state using a declarative flow pipeline
  - `flows.ts` — flow pipeline definitions (maps to the flow diagrams)
  - `store.ts` — nanostore-backed reactive state, synced to React via `useSyncExternalStore`
  - `screens/` — one file per screen
- `src/lib/` — core business logic (agent runner, wizard session, framework config, registry)
- `src/frameworks/` — one directory per supported framework, each with detection, context gathering, and agent prompt config
- `src/utils/` — OAuth, env vars, analytics, ampli settings

## Key conventions

- **Screens are passive.** Screens observe session state and render accordingly. They do not own navigation logic — the router derives the active screen from session state.
- **Session is the single source of truth.** All state lives in `WizardSession`. Screens and steps read from and write to the session; they do not communicate directly.
- **Flows are declarative.** Each flow is a pipeline of `{ screen, show, isComplete }` entries. Navigation advances automatically when `isComplete` returns true.
- **Overlays interrupt without breaking flow.** `OutageScreen` and `SettingsOverrideScreen` are pushed onto an overlay stack and popped when resolved, resuming the flow where it left off.
- **Slash commands are always available.** `/org`, `/project`, and others must be interceptable at any point in the session, not just at specific screens.

## Development commands

```bash
pnpm try       # run the wizard locally
pnpm build     # compile TypeScript
pnpm test      # build + jest
pnpm flows     # render docs/flows.md diagrams to docs/diagrams/
```
