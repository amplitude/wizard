/**
 * MCP bridge for the AI-SDK inner-loop runner — Phase D-4 of the wizard's
 * AI-SDK migration.
 *
 * The legacy `agent-interface.ts` runner registers the in-process
 * `wizard-tools` MCP server (`createWizardToolsServer`, ~10 tools) directly
 * with the Claude Agent SDK via `mcpServers`. The AI-SDK runner can't
 * consume that registration shape, so this module bridges it: an MCP
 * `Client` is connected to the existing `McpServer` instance via
 * `InMemoryTransport.createLinkedPair()`, then `listTools()` is called and
 * each discovered tool is wrapped as an AI-SDK `dynamicTool` whose
 * `execute` round-trips through `client.callTool(...)`.
 *
 * Why bridge instead of native AI-SDK reimplementation?
 *
 *   - One source of truth for tool schemas (`set_env_values`,
 *     `confirm_event_plan`, `choose`, etc.). Native re-impls drift —
 *     PR #634 noted the AI-SDK runner only had 4 of ~10 tools, so the
 *     agent silently lost `confirm_event_plan` / `set_env_values` /
 *     skill loaders / `wizard_feedback` whenever the env flag flipped on.
 *   - Future schema updates land in `wizard-tools.ts` once and propagate
 *     to both runners.
 *
 * Why in-memory transport instead of `@ai-sdk/mcp`'s
 * `experimental_createMCPClient`?
 *
 *   - That package isn't installed (the wizard ships `ai@6.0.175` but
 *     `@ai-sdk/mcp` is a separate, post-v6 package). The
 *     `@modelcontextprotocol/sdk` package IS installed (transitively via
 *     `@anthropic-ai/claude-agent-sdk`) and exposes `InMemoryTransport`
 *     for exactly this use case (in-process client-server pairing). When
 *     `@ai-sdk/mcp` lands as a direct dependency we can swap the bridge
 *     internals; the public surface (`bridgeWizardToolsMcp`) stays.
 */
import type { ToolSet } from 'ai';
import { dynamicTool, jsonSchema } from 'ai';

import { logToFile } from '../../utils/debug.js';
import { WIZARD_TOOLS_SERVER_NAME } from '../wizard-tools.js';

/**
 * Minimal JSON Schema 7 shape we accept from MCP `listTools()` responses.
 * Mirrors the relevant subset of `@types/json-schema`'s `JSONSchema7`
 * without forcing a transitive dep on that package — the AI-SDK
 * `jsonSchema(...)` helper just passes the schema through to the
 * provider, so we treat it as opaque here.
 */
type JsonSchemaLike = {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [k: string]: unknown;
};

/**
 * Shape of the value `wizardToolsServer` carries: the `createSdkMcpServer`
 * return is `{ type: 'sdk'; name: string; instance: McpServer }`. We
 * deliberately keep `instance` typed as `unknown` here because importing
 * `@modelcontextprotocol/sdk/server/mcp.js`'s `McpServer` type at this
 * boundary would couple the AI-SDK runner to the MCP SDK's d.ts surface,
 * which the legacy runner already does via `wizard-tools.ts`. The bridge
 * casts to the minimal shape it needs at the connect call site.
 */
export interface WizardToolsServerInstance {
  /** The live `McpServer` instance built by `createSdkMcpServer`. */
  instance: unknown;
  /** Stable server name (`'wizard-tools'`). */
  name?: string;
  /** Optional discriminator from the agent SDK's serializable config shape. */
  type?: string;
}

/**
 * Result of bridging the wizard-tools MCP server: an AI-SDK-compatible
 * tool surface plus a teardown function the runner calls in `finally`.
 */
export interface WizardToolsBridge {
  /**
   * AI-SDK `ToolSet` keyed by the canonical Claude-Agent-SDK MCP name
   * shape (`mcp__wizard-tools__<toolName>`) so policy hooks
   * (`wizardCanUseTool`, NDJSON `tool_call` envelopes) see the same
   * names regardless of which runner is active.
   */
  tools: ToolSet;
  /** Tool names exposed by this bridge — used for diagnostics. */
  toolNames: string[];
  /**
   * Tear down the in-memory transport pair. The runner calls this in
   * `finally` so a streamText throw doesn't leak the client's listener
   * (which would keep the McpServer alive past the wizard run).
   */
  close: () => Promise<void>;
}

/**
 * The minimal `McpServer.connect(transport)` shape we depend on. Mirrors
 * `@modelcontextprotocol/sdk/server/mcp.js#McpServer.connect`.
 */
interface MinimalMcpServer {
  connect(transport: unknown): Promise<void>;
  close?: () => Promise<void> | void;
}

/**
 * The minimal `Client` shape we depend on. Mirrors
 * `@modelcontextprotocol/sdk/client/index.js#Client`.
 */
interface MinimalMcpClient {
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
  listTools(): Promise<{
    tools: Array<{
      name: string;
      description?: string;
      inputSchema: JsonSchemaLike;
    }>;
  }>;
  callTool(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<{
    content?: Array<{ type: string; text?: string; [k: string]: unknown }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
    [k: string]: unknown;
  }>;
}

/**
 * Bridge an in-process wizard-tools MCP server into an AI-SDK `ToolSet`.
 *
 * Steps:
 *   1. Create a linked in-memory transport pair (`InMemoryTransport.createLinkedPair`).
 *   2. Connect the existing `McpServer` instance to the server end.
 *   3. Construct an MCP `Client` and connect to the client end.
 *   4. Call `listTools()` to discover the schema set the wizard exposes.
 *   5. Wrap each tool as an AI-SDK `dynamicTool` whose `execute` calls
 *      `client.callTool(...)` and unwraps the response into a JSON
 *      payload the model can consume.
 *
 * The returned `tools` map is keyed by the canonical Claude-Agent-SDK
 * MCP name shape (`mcp__wizard-tools__<toolName>`) so:
 *   - `wizardCanUseTool` (which already special-cases
 *     `mcp__wizard-tools__load_skill` etc.) applies uniformly across
 *     both runners.
 *   - NDJSON `tool_call` envelopes carry the same `data.tool` value that
 *     the legacy runner emits.
 */
export async function bridgeWizardToolsMcp(
  server: WizardToolsServerInstance,
): Promise<WizardToolsBridge> {
  // Lazy-import the MCP SDK so the legacy runner — which never calls this
  // bridge — doesn't pay the import cost. The MCP SDK is already a
  // transitive dep via `@anthropic-ai/claude-agent-sdk`, so no new
  // package surface ships with this PR.
  const [{ Client }, { InMemoryTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/inMemory.js'),
  ]);

  const mcpServer = server.instance as MinimalMcpServer;
  if (!mcpServer || typeof mcpServer.connect !== 'function') {
    throw new Error(
      '[run-agent-mcp-bridge] wizard-tools server is missing a connectable instance — got ' +
        typeof server.instance,
    );
  }

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await mcpServer.connect(serverTransport);

  const client = new Client(
    { name: 'wizard-ai-sdk-runner', version: '1.0.0' },
    { capabilities: {} },
  ) as unknown as MinimalMcpClient;

  await client.connect(clientTransport);

  const { tools: discovered } = await client.listTools();

  logToFile(
    `[run-agent-mcp-bridge] bridged ${
      discovered.length
    } wizard-tools: ${discovered.map((t) => t.name).join(', ')}`,
  );

  const tools: ToolSet = {};
  const toolNames: string[] = [];

  for (const t of discovered) {
    const aiSdkName = `mcp__${WIZARD_TOOLS_SERVER_NAME}__${t.name}`;
    toolNames.push(aiSdkName);

    // The MCP `inputSchema` is already JSON Schema. Pipe it straight
    // into AI-SDK `jsonSchema(...)` so the model sees the same input
    // contract the legacy runner advertises. We deliberately do NOT
    // re-validate on the client side — the McpServer validates against
    // the same schema before invoking the handler, so double validation
    // would be redundant and any drift between the two would surface as
    // a confusing "valid input rejected" error.
    // `jsonSchema(...)` accepts a `JSONSchema7`; we pipe the MCP-supplied
    // schema through unchanged. Casting to `unknown` here, then to the
    // helper's expected param type, avoids forcing `@types/json-schema`
    // into the wizard's direct deps. The MCP server already validated
    // the schema shape at registration time.
    //
    // **Important**: omit the `validate` option entirely. When `validate`
    // is absent, AI-SDK's `safeValidateTypes` returns the parsed JSON
    // input unchanged (`{ success: true, value, rawValue: value }`) and
    // hands that value to `execute(input)`. If we instead supplied a
    // `validate: () => ({ success: true, value: undefined })`, the SDK
    // would dutifully replace the parsed input with `undefined` and
    // every bridged tool's `execute` would receive `undefined` →
    // `client.callTool({ arguments: {} })`, silently dropping every
    // model-supplied argument. The McpServer is the single source of
    // truth for validation (the design rationale above); omitting
    // `validate` here defers validation to the server without erasing
    // the input payload.
    const schema = jsonSchema(
      t.inputSchema as unknown as Parameters<typeof jsonSchema>[0],
    );

    tools[aiSdkName] = dynamicTool({
      description: t.description ?? '',
      inputSchema: schema,
      execute: async (input) => {
        try {
          const result = await client.callTool({
            name: t.name,
            arguments:
              input === null || input === undefined
                ? {}
                : (input as Record<string, unknown>),
          });
          // The MCP `callTool` response carries one or more content
          // blocks. The wizard-tools server uses `text`-typed content
          // exclusively (see `toWizardToolErrorContent` and the success
          // branches in `wizard-tools.ts`), so we surface a string when
          // there's a single text block and a structured envelope
          // otherwise — matching what the AI-SDK model adapter expects
          // for an MCP-style tool result.
          if (result.isError) {
            const text = extractFirstText(result.content) ?? 'tool error';
            return { error: text, content: result.content };
          }
          const text = extractFirstText(result.content);
          if (text != null && (result.content?.length ?? 0) === 1) {
            return text;
          }
          return {
            content: result.content,
            structuredContent: result.structuredContent,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logToFile(
            `[run-agent-mcp-bridge] callTool(${t.name}) threw: ${message}`,
          );
          return { error: 'wizard_tools_bridge_error', message };
        }
      },
    });
  }

  return {
    tools,
    toolNames,
    close: async () => {
      // Close the client first — that flushes any in-flight requests
      // back to the server so it can shut down cleanly. The
      // InMemoryTransport pair gets garbage collected once both ends
      // are released. The bridge does NOT own `mcpServer` (created by
      // the caller via createWizardToolsServer) so we leave its
      // lifecycle to its owner; closing it here would disconnect it
      // from its transport and break any retry/reconnect logic the
      // dispatch layer may add later.
      try {
        await client.close();
      } catch (err) {
        logToFile(
          `[run-agent-mcp-bridge] client.close threw (non-fatal): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    },
  };
}

function extractFirstText(
  content: Array<{ type: string; text?: string }> | undefined,
): string | null {
  if (!content || content.length === 0) return null;
  const first = content[0];
  if (first?.type === 'text' && typeof first.text === 'string') {
    return first.text;
  }
  return null;
}
