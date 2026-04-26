/**
 * wizard-mcp-server — External MCP server for AI coding agents.
 *
 * Exposes the wizard's read-only agent-ops functions as MCP tools over stdio.
 * Third-party AI coding agents (Claude Code, Cursor, Codex, etc.) can spawn
 * this server as a child process and call our operations as typed tools
 * instead of shelling out to the CLI and parsing stdout.
 *
 * Invoked via `amplitude-wizard mcp serve`.
 *
 * Design notes:
 * - Speaks MCP over stdio only. Writes the MCP protocol to stdout; nothing else.
 *   Any diagnostic logging MUST go to stderr.
 * - Uses `@modelcontextprotocol/sdk` — the canonical MCP SDK — NOT the
 *   in-process `createSdkMcpServer` helper from `@anthropic-ai/claude-agent-sdk`
 *   (which is only for in-process agent loops, not standalone stdio servers).
 * - Tools wrap the pure functions in `agent-ops.ts`. No UI, no auth side
 *   effects, no writes — this PR keeps the surface read-only.
 */
import { z } from 'zod';
import {
  runDetect,
  runStatus,
  runPlan,
  runVerify,
  getAuthStatus,
  getAuthToken,
  type DetectResult,
  type StatusResult,
  type AuthStatusResult,
  type AuthTokenResult,
  type PlanResult,
  type VerifyResult,
} from './agent-ops.js';

const SERVER_NAME = 'amplitude-wizard';
const SERVER_VERSION = '1.0.0';

/**
 * Minimal shape of the MCP server's `registerTool` method that the wizard
 * tools use. Narrower than `McpServer`'s full type so unit tests can mock it
 * without pulling in the SDK.
 */
export interface WizardMcpToolRegistrar {
  registerTool: (
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: Record<string, z.ZodTypeAny>;
    },
    handler: (args: unknown) => unknown,
  ) => unknown;
}

/** Wrap a JSON-serializable value as MCP `content` for tool results. */
function jsonContent(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  };
}

/**
 * Register the wizard's tools onto a newly-constructed MCP server.
 * Exposed for unit tests — production path is {@link startAgentMcpServer}.
 */
export function registerWizardTools(server: WizardMcpToolRegistrar): void {
  // -- detect_framework ---------------------------------------------------
  server.registerTool(
    'detect_framework',
    {
      title: 'Detect framework',
      description:
        'Detect which web/mobile framework a project uses (Next.js, Vue, ' +
        'React Native, Django, etc.). Returns the integration id, framework ' +
        'name, and per-detector signals. If installDir is omitted, the ' +
        'wizard inspects the current working directory.',
      inputSchema: {
        installDir: z
          .string()
          .optional()
          .describe(
            'Absolute path to the project to inspect. Defaults to the current working directory.',
          ),
      },
    },
    async (args: unknown) => {
      const { installDir } = (args ?? {}) as { installDir?: string };
      const result: DetectResult = await runDetect(installDir ?? process.cwd());
      return jsonContent(result);
    },
  );

  // -- get_project_status -------------------------------------------------
  server.registerTool(
    'get_project_status',
    {
      title: 'Get project status',
      description:
        'Report the end-to-end Amplitude setup state of a project: detected ' +
        'framework, whether the Amplitude SDK is installed, whether an API ' +
        'key is configured, and whether the user is logged in. Safe to call ' +
        'repeatedly — does not write anything.',
      inputSchema: {
        installDir: z
          .string()
          .optional()
          .describe(
            'Absolute path to the project to inspect. Defaults to the current working directory.',
          ),
      },
    },
    async (args: unknown) => {
      const { installDir } = (args ?? {}) as { installDir?: string };
      const result: StatusResult = await runStatus(installDir ?? process.cwd());
      return jsonContent(result);
    },
  );

  // -- plan_setup ---------------------------------------------------------
  server.registerTool(
    'plan_setup',
    {
      title: 'Plan an Amplitude setup',
      description:
        'Run the planning phase: detect the framework, build a structured ' +
        'WizardPlan (framework, sdk, intended file changes), and persist it ' +
        'to disk under a fresh planId. NO files are touched. The returned ' +
        '`planId` can be passed to `apply` (CLI: `amplitude-wizard apply ' +
        '--plan-id <id> --yes`) to actually execute the plan within 24h. ' +
        'This tool is read-only and safe to call repeatedly — each call ' +
        'creates a new plan.',
      inputSchema: {
        installDir: z
          .string()
          .optional()
          .describe(
            'Absolute path to the project to plan against. Defaults to the current working directory.',
          ),
      },
    },
    async (args: unknown) => {
      const { installDir } = (args ?? {}) as { installDir?: string };
      const result: PlanResult = await runPlan(installDir ?? process.cwd());
      return jsonContent(result);
    },
  );

  // -- verify_setup -------------------------------------------------------
  server.registerTool(
    'verify_setup',
    {
      title: 'Verify an Amplitude setup',
      description:
        'Cheap, no-network check that the project has the Amplitude SDK ' +
        'installed, an API key configured, and a detectable framework. ' +
        'Returns { outcome: "pass" | "fail", failures: [...] } with ' +
        'structured reasons for any failures. Does NOT poll for ingestion; ' +
        'use the CLI for that.',
      inputSchema: {
        installDir: z
          .string()
          .optional()
          .describe(
            'Absolute path to the project to verify. Defaults to the current working directory.',
          ),
      },
    },
    async (args: unknown) => {
      const { installDir } = (args ?? {}) as { installDir?: string };
      const result: VerifyResult = await runVerify(installDir ?? process.cwd());
      return jsonContent(result);
    },
  );

  // -- get_auth_status ----------------------------------------------------
  server.registerTool(
    'get_auth_status',
    {
      title: 'Get auth status',
      description:
        'Check whether the human operator is logged into Amplitude and when ' +
        'their current token expires. Returns loggedIn:false if no ' +
        'credentials are stored. Does NOT return the token itself — use ' +
        'get_auth_token for that.',
      inputSchema: {},
    },
    () => {
      const result: AuthStatusResult = getAuthStatus();
      return jsonContent(result);
    },
  );

  // -- get_auth_token -----------------------------------------------------
  server.registerTool(
    'get_auth_token',
    {
      title: 'Get auth token',
      description:
        'SECURITY-SENSITIVE: returns a live OAuth access token for the ' +
        'logged-in Amplitude user. AI agents MUST NOT log, display, or ' +
        'forward this value to external systems. Use it only to authenticate ' +
        'subsequent Amplitude API calls in the current task. Returns ' +
        '{ token: null } if the user is not logged in — callers should ' +
        'handle that case instead of treating it as an error.',
      inputSchema: {},
    },
    () => {
      const result: AuthTokenResult = getAuthToken();
      return jsonContent(result);
    },
  );
}

/**
 * Start the external MCP server and attach it to stdio.
 *
 * Resolves only when the process is about to exit. Installs SIGINT/SIGTERM
 * handlers that close the transport and exit 0. If the parent agent closes
 * stdin (typical MCP client disconnect), the transport's `onclose` fires
 * and we exit 0.
 */
export async function startAgentMcpServer(): Promise<void> {
  // Dynamic import — MCP SDK is published as ESM-first and is large; keeping
  // this lazy means the CLI binary doesn't pay the load cost unless you
  // actually invoke `mcp serve`.
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { StdioServerTransport } = await import(
    '@modelcontextprotocol/sdk/server/stdio.js'
  );

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerWizardTools(server as unknown as WizardMcpToolRegistrar);

  const transport = new StdioServerTransport();

  let shuttingDown = false;
  const shutdown = async (exitCode = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await server.close();
    } catch {
      /* ignore close errors during shutdown */
    }
    process.exit(exitCode);
  };

  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));

  await server.connect(transport);

  // MCP SDK's Protocol.connect() internally reassigns transport.onerror,
  // transport.onclose, and transport.onmessage. Wire our handlers *after*
  // connect() so they override the SDK defaults — otherwise the process
  // won't exit cleanly when the parent agent closes stdin (hang), and
  // transport errors go unlogged.
  transport.onerror = (err: Error): void => {
    process.stderr.write(
      `amplitude-wizard mcp serve: transport error: ${err.message}\n`,
    );
  };
  transport.onclose = (): void => {
    // Parent agent disconnected (stdin closed) — exit cleanly.
    void shutdown(0);
  };
  // The transport owns stdin and keeps the event loop alive until it closes.
}
