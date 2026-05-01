# `src/steps/` — post-agent discrete steps

Steps run **after** the Claude agent finishes its work. They handle the
deterministic mechanical follow-ups that are easier to do in plain code
than to delegate back to the agent: installing the MCP server into the
user's editor, uploading env vars to deployment platforms, formatting
the files the agent edited, and creating the user's first dashboard.

## What lives here

| File / Dir | Purpose |
|------------|---------|
| `add-mcp-server-to-clients/` | Install the Amplitude MCP server into Claude Code, Cursor, VS Code, Codex, Gemini, Windsurf, etc. — see `../../docs/mcp-installation.md` for editor-specific behavior. |
| `add-or-update-environment-variables.ts` | Read/write `.env` files at the project root after the agent run. |
| `upload-environment-variables/` | Push env vars to deployment platforms (Vercel today; designed for more). |
| `run-prettier.ts` | Format the files the agent touched, scoped to the changed paths only. |
| `create-dashboard.ts` | Create a starter dashboard from the approved event plan and write the URL into `.amplitude/dashboard.json`. |
| `index.ts` | Public re-exports. |

## Conventions

- **Steps are idempotent.** If a step has already done its work (env var
  already set, MCP already installed), it should detect that and no-op.
- **Steps observe and mutate the session.** Like screens, they read from
  and write to `WizardSession`. They report progress through the same
  `WizardUI` abstraction that screens use.
- **Bounded timeouts.** Long-running steps (dashboard creation, network
  uploads) wrap their work in `withTimeout` from
  `../ui/tui/utils/withTimeout.ts` so a hung backend can't stall the run.

## See also

- `../../CLAUDE.md` — `### Steps` section
- `../../docs/mcp-installation.md` — MCP install behavior across editors
- `../../docs/engineering-patterns.md` — `withTimeout` and `withRetry` usage
