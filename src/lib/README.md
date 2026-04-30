# `src/lib/` — core wizard business logic

Framework-agnostic services consumed by every wizard run. Anything that
isn't UI (`src/ui/`), CLI command wiring (`src/commands/`), or post-agent
discrete steps (`src/steps/`) lives here.

## Start reading at

- **`wizard-session.ts`** — `WizardSession`, the single source of truth for
  all wizard state (`RunPhase`, `McpOutcome`, `OutroKind`, etc.). Screens
  and steps both read from and write to this.
- **`agent-runner.ts`** — universal entry point that orchestrates a wizard
  run for any framework.
- **`agent-interface.ts`** — creates and runs the Claude agent via
  `@anthropic-ai/claude-agent-sdk` (MCP servers, hooks, model, permissions).
- **`commandments.ts`** — system prompt rules always appended to the agent.
- **`framework-config.ts`** + **`registry.ts`** — the contract every
  framework implements (`FrameworkConfig`) and the registry that maps
  detection results to configs.

## In-process MCP tools the agent can call

`wizard-tools.ts` exposes `check_env_keys`, `set_env_values`,
`detect_package_manager`, `confirm_event_plan`, `confirm`, `choose`,
`report_status`, and `wizard_feedback` to the wizard's internal Claude
agent. Distinct from `wizard-mcp-server.ts` (the **external** stdio MCP
server invoked via `amplitude-wizard mcp serve`, used by third-party AI
coding agents like Claude Code or Cursor).

## See also

- `../../CLAUDE.md` — project-wide architecture overview
- `../../docs/critical-files.md` — files ranked by blast radius
- `../../docs/engineering-patterns.md` — async safety, retry, error
  classification patterns used throughout this directory
