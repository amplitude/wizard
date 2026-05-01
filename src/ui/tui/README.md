# `src/ui/tui/` — interactive terminal UI

Built with [Ink](https://github.com/vadimdemedes/ink) (React for CLIs) and
[nanostores](https://github.com/nanostores/nanostores) for reactive state.
This directory implements the persistent prompt + screen pipeline that
makes the wizard feel like Claude Code.

## Mental model

- **Screens are passive.** They observe `WizardSession` state and render.
  They never own navigation logic.
- **Session is the single source of truth.** All state lives in
  `WizardSession` (`../../lib/wizard-session.ts`). Screens and steps read
  from and write to it; they do not communicate directly.
- **Flows are declarative.** Each flow is a pipeline of
  `{ screen, show, isComplete }` entries (`flows.ts`). The router walks
  the pipeline and resolves the active screen automatically.
- **Overlays interrupt without breaking flow.** `Outage`, `Snake`, `Mcp`,
  `Slack`, `Logout`, `Login` push onto an overlay stack and pop when
  resolved, resuming the underlying flow. See `Overlay` in `router.ts`.

## Start reading at

| File | Why |
|------|-----|
| `start-tui.ts` | Entry point — Ink bootstrap + OSC terminal-color detection |
| `App.tsx` | Root component — layout, screen resolution, transitions, error boundary |
| `store.ts` | `WizardStore`, `Screen`, `Overlay`, `Flow` — reactive state |
| `router.ts` | `WizardRouter` — resolves the active screen from session state |
| `flows.ts` | Declarative flow pipelines (`Screen` + `Flow` enums) |
| `screen-registry.tsx` | Maps screen/overlay names → React components |
| `screens/` | One file per screen (Auth, Run, Outro, MCP, Slack, …) |
| `console-commands.ts` | Slash commands (`/region`, `/login`, `/whoami`, …) |
| `ink-ui.ts` | `InkUI` — the TUI implementation of `WizardUI` |

## See also

- `../../../CLAUDE.md` — `### TUI layer` section has the full file-by-file table
- `../../../docs/flows.md` — flow diagrams (source of truth for UX)
- `../../../docs/engineering-patterns.md` — async safety, retry, error
  classification patterns
