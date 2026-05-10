// Mock for @anthropic-ai/claude-agent-sdk

export type SDKMessage =
  | {
      type: 'assistant';
      message?: { content?: Array<{ type: string; text?: string }> };
    }
  | { type: 'result'; subtype: 'success'; result?: string }
  | { type: 'result'; subtype: string; errors?: string[] }
  | {
      type: 'system';
      subtype: 'init';
      model?: string;
      tools?: string[];
      mcp_servers?: unknown[];
    }
  | { type: string };

export type Options = {
  model?: string;
  cwd?: string;
  permissionMode?: string;
  mcpServers?: Record<string, unknown>;
  canUseTool?: (toolName: string, input: unknown) => Promise<unknown>;
  tools?: { type: string; preset: string };
  systemPrompt?: { type: string; preset: string };
};

export type QueryInput = {
  prompt: string;
  options?: Options;
};

// Mock generator that yields a success result
function* mockQueryGenerator(): Generator<SDKMessage, void> {
  yield {
    type: 'system',
    subtype: 'init',
    model: 'claude-opus-4-5-20251101',
    tools: [],
    mcp_servers: [],
  };
  yield {
    type: 'result',
    subtype: 'success',
    result: 'Mock agent completed successfully',
  };
}

function query(_input: QueryInput): Generator<SDKMessage, void> {
  return mockQueryGenerator();
}

// ---------------------------------------------------------------------------
// MCP server helpers — minimal mocks so `createWizardToolsServer` can be
// instantiated and individual tool handlers can be invoked from tests.
//
// The real SDK builds an `McpServer` instance with a deep tool-registry. For
// unit tests we only need to (a) capture the tool definitions, and (b) expose
// them on `instance._registeredTools` keyed by name — that's the same shape
// `wizard-tools.test.ts` reaches into to call handlers directly.
// ---------------------------------------------------------------------------

// Tool handlers may be sync or async. We accept both and rely on the caller
// (test) to await as needed. Using `unknown` directly (without `Promise<…>`
// in the union) keeps the eslint @typescript-eslint/no-redundant-type-constituents
// rule happy: `unknown` already encompasses Promise.
export type MockToolHandler = (
  args: Record<string, unknown>,
  extra?: unknown,
) => unknown;

export interface MockToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
  handler: MockToolHandler;
}

function tool(
  name: string,
  description: string,
  inputSchema: unknown,
  handler: MockToolHandler,
): MockToolDefinition {
  return { name, description, inputSchema, handler };
}

export interface MockMcpServerInstance {
  _registeredTools: Record<string, MockToolDefinition>;
}

export interface MockMcpSdkServerConfigWithInstance {
  type: 'sdk';
  name: string;
  instance: MockMcpServerInstance;
}

function createSdkMcpServer(config: {
  name: string;
  version: string;
  tools: MockToolDefinition[];
}): MockMcpSdkServerConfigWithInstance {
  const registry: Record<string, MockToolDefinition> = {};
  for (const t of config.tools) {
    registry[t.name] = t;
  }
  return {
    type: 'sdk',
    name: config.name,
    instance: { _registeredTools: registry },
  };
}
