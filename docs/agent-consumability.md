# Agent consumability

How outer coding agents (Claude Code, Cursor, Codex, Goose, custom
orchestrators) consume the wizard's state. The wizard exposes the same
data through three surfaces — pick the one that matches your runtime.

## Surfaces

1. **CLI JSON** — every command listed below supports `--json` and
   emits a Zod-validated envelope with `v: 1`. Use this from a shell,
   make, or any process that can spawn a child binary.
2. **External MCP server** — `amplitude-wizard mcp serve` exposes the
   read-only orchestration tools as typed MCP tools. Use this from a
   long-lived AI agent that's already speaking MCP.
3. **NDJSON streams** — `wizard --agent` emits a structured stream of
   events to stdout. Use this when you need to observe a wizard run
   live.

All three surfaces are byte-for-byte aligned (modulo timestamps): the
CLI command and the MCP tool that mirror each other call into the same
builder in `src/lib/orchestration/envelopes.ts`.

## Read-only inspection

The orchestration store is read-only via the MCP server. To answer a
choice or mark a verification, spawn the matching CLI subcommand —
that's the wizard's deliberate safety boundary.

| What you want to know                       | CLI command                                      | MCP tool                       |
|--------------------------------------------|-------------------------------------------------|-------------------------------|
| Where the wizard left off                  | `wizard orchestration status --json`             | `get_orchestration_status`    |
| Just the next-action bit                   | (subset of status)                               | `get_last_stopping_point`     |
| Every task in the store                    | `wizard tasks --json`                            | `list_tasks`                  |
| One specific task                          | `wizard task <id> --json`                        | `get_task`                    |
| Every session                              | `wizard sessions --json`                         | `list_sessions`               |
| One specific session                       | `wizard session <id> --json`                     | `get_session`                 |
| Pending user-choice checkpoints            | `wizard choice list --json`                      | `list_choices`                |
| One specific choice                        | `wizard choice show <id> --json`                 | `get_choice`                  |
| Pending manual verifications               | `wizard verification list --json`                | `list_manual_verifications`   |
| One specific verification                  | `wizard verification show <id> --json`           | `get_manual_verification`     |
| MCP capabilities (skipped/installed/etc.)  | (read store directly)                            | `list_mcp_capabilities`       |
| One specific MCP capability                | (read store directly)                            | `get_mcp_capability`          |

## Mutations (CLI only)

| Action                          | Command                                                                |
|--------------------------------|------------------------------------------------------------------------|
| Answer a choice                 | `wizard choice answer <id> --option <option-id> [--confirm-human]`     |
| Mark a verification             | `wizard verification mark <id> --status <passed\|failed\|skipped>`     |
| Resume a session                | `wizard resume <session-id> [--execute]`                               |

`--confirm-human` is required when the choice has `requiresHuman: true`.
Automation must NOT pass `--confirm-human` on its own — that flag is the
operator's attestation that a human is present and authorising the
answer. Without it, the command exits with `CHOICE_REQUIRES_HUMAN=5`.

## Examples

### 1. Claude Code — "before I open this PR, what does the wizard need from me?"

```typescript
// Inside a Claude Code skill or tool handler.
import { McpClient } from '@modelcontextprotocol/sdk/client/mcp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'amplitude-wizard',
  args: ['mcp', 'serve'],
});
const client = new McpClient({ name: 'claude-code', version: '1.0' }, {});
await client.connect(transport);

const status = await client.callTool({
  name: 'get_orchestration_status',
  arguments: { installDir: process.cwd() },
});

const env = JSON.parse(
  (status.content[0] as { text: string }).text,
);
if (env.lastStoppingPoint.pendingChoices.length > 0) {
  // Surface the choice to the human; we don't auto-answer.
  console.log('Wizard needs a decision:', env.lastStoppingPoint.pendingChoices[0]);
}
```

### 2. Cursor — query the CLI directly from a chat command

Cursor's editor-side AI doesn't yet speak MCP, so spawn the CLI:

```bash
amplitude-wizard orchestration status --json | jq '.lastStoppingPoint.nextAction'
```

The `jq` snippet returns `{ kind, description, command }`. Cursor's chat
can shell out and surface `description` to the human, then offer to run
`command` for them.

### 3. Goose / OpenAI agents — stream a wizard run live

When you want to observe a fresh run instead of inspecting state, use
`--agent`:

```typescript
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const child = spawn('npx', ['@amplitude/wizard', '--agent'], {
  cwd: '/path/to/project',
});
const rl = readline.createInterface({ input: child.stdout });
for await (const line of rl) {
  const event = JSON.parse(line);
  if (event.type === 'wizard.prompt' && event.requiresHuman) {
    // Surface to the human, then re-spawn with the chosen flag.
    break;
  }
}
```

### 4. CI bot that resumes the wizard after auth refresh

Inside a GitHub Action or other CI runner:

```bash
set -e
amplitude-wizard orchestration status --json > /tmp/status.json
KIND=$(jq -r '.lastStoppingPoint.nextAction.kind' /tmp/status.json)
if [ "$KIND" = "fix_auth" ]; then
  amplitude-wizard login   # interactive — only the human can refresh
fi
RESUME=$(jq -r '.lastStoppingPoint.nextAction.command | join(" ")' /tmp/status.json)
eval "$RESUME"
```

### 5. A "watchdog" automation that flags abandoned manual verifications

A scheduled cron job in CI:

```bash
amplitude-wizard verification list --json --status pending \
  | jq -r '.verifications[] | "\(.id) — \(.whatToVerify)"'
```

The job's output is the list of verifications waiting on a human. Pair
it with a Slack notifier to ping the responsible owner. (Use
`--status all` for the full history including passed/failed.)

## Discoverability

`--json` envelopes always include:

- `v: 1` — schema version. Outer agents can branch on this.
- `type: 'orchestration_<surface>'` — the surface name (e.g.
  `orchestration_status`).
- `generatedAt` — ISO timestamp.
- `installDir` — absolute path the envelope is scoped to.

The MCP tool result is a `text` content block whose body is the same
JSON envelope — `JSON.parse(result.content[0].text)` to consume.

## Backward compatibility

PR 3 only adds tools — every PR 1 and PR 2 tool / command continues to
work unchanged. The `v: 1` envelope is stable; future schema changes
will bump the version, and old tools will continue to emit `v: 1` until
explicitly retired.

## See also

- [`docs/orchestration.md`](./orchestration.md) — full schema, store
  semantics, lifecycle invariants, and migration plan.
- [`docs/exit-codes.md`](./exit-codes.md) — every exit code the wizard
  can return.
- [`docs/agent-ndjson-contract.md`](./agent-ndjson-contract.md) — the
  `wizard --agent` NDJSON event surface.
