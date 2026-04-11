# MCP Installation

The wizard installs the [Amplitude MCP server](https://mcp.amplitude.com/mcp) into the user's
editors as part of the main wizard flow and via the standalone `/mcp` slash command.

## How it works

The wizard detects which MCP-capable editors are present on the machine, then writes
the Amplitude MCP server config into each editor's config file. No access token is
pre-populated — each editor triggers OAuth on first use and handles token refresh
automatically.

```
wizard
  → detect supported editors (VS Code, Zed, Cursor, Claude Desktop, Claude Code, Codex)
  → confirm with user
  → write MCP server config (URL only, no auth header)
  → editor prompts user for OAuth on first tool call
```

## Supported clients

| Client | Config location | Config key | Transport |
|--------|----------------|------------|-----------|
| VS Code | `~/Library/Application Support/Code/User/mcp.json` (Mac) | `servers` | streamable-http (native) |
| Zed | `~/.config/zed/settings.json` | `context_servers` | streamable-http (native) |
| Cursor | `~/.cursor/mcp.json` | `mcpServers` | streamable-http (native, explicit `transport` field) |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) | `mcpServers` | streamable-http via `npx mcp-remote` |
| Claude Code | CLI — `claude mcp add` | — | streamable-http |
| Codex | CLI — `codex mcp add` | — | streamable-http |

## Server URL

| Region | URL |
|--------|-----|
| US (default) | `https://mcp.amplitude.com/mcp` |
| EU | `https://mcp.eu.amplitude.com/mcp` |

The local dev server (`--local-mcp` flag) points to `http://localhost:8787/mcp`.

## Authentication

MCP clients authenticate via **OAuth 2.0**. The wizard does not write a Bearer token
into the config. When the user first invokes an Amplitude MCP tool in their editor,
the client opens a browser for Amplitude OAuth and handles token refresh automatically.

This is the approach recommended in the [Amplitude MCP docs](https://amplitude.com/docs/amplitude-ai/amplitude-mcp).

## Code structure

```
src/steps/add-mcp-server-to-clients/
  index.ts              — orchestration: detect, add, remove
  MCPClient.ts          — abstract base + DefaultMCPClient (file-based config)
  defaults.ts           — URL builder, server config factories, feature list
  clients/
    visual-studio-code.ts
    zed.ts
    cursor.ts
    claude.ts           — Claude Desktop
    claude-code.ts      — Claude Code CLI
    codex.ts            — Codex CLI

src/ui/tui/
  screens/McpScreen.tsx         — TUI screen (detect → confirm → pick → install)
  services/mcp-installer.ts     — service layer between McpScreen and business logic
```

## Feature scoping

The MCP URL accepts a `features` query param to limit which tools are exposed
(e.g. `?features=dashboards,insights`). The wizard installs with all features
selected by default, which omits the param entirely.

See `defaults.ts` → `AVAILABLE_FEATURES` and `buildMCPUrl()` for the full list.
