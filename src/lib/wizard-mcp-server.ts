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
 * - Tools wrap the pure functions in `agent-ops.ts`. No UI. Most tools are
 *   read-only; `plan_setup` persists a new WizardPlan under a fresh planId.
 */
import { z } from 'zod';
import {
  runDetect,
  runStatus,
  runPlan,
  runVerify,
  runGetEventPlan,
  getAuthStatus,
  getAuthToken,
  type DetectResult,
  type StatusResult,
  type AuthStatusResult,
  type AuthTokenResult,
  type PlanResult,
  type VerifyResult,
  type EventPlanReadResult,
} from './agent-ops.js';
import {
  readDashboardPlan,
  writeDashboardPlan,
  DashboardPlanInputSchema,
  type DashboardPlanInput,
} from './dashboard-plan.js';
import { wrapMcpServerWithSentry } from './observability/index.js';

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
 * Build the `installDir` zod field. Centralized so the
 * `.string().optional().describe(...)` wrapping doesn't drift across the
 * read-only tools that accept it. The `action` clause is the unique
 * mid-sentence text (e.g. `"to inspect"`, `"to plan against"`, or `""`
 * for "project." alone). Each tool keeps its bespoke phrasing — the
 * agent reads these as part of its prompt, so this field assembles
 * exactly the byte sequence the prior inline literals produced.
 */
function installDirField(action: string) {
  const subject = action ? `project ${action}.` : 'project.';
  return z
    .string()
    .optional()
    .describe(
      `Absolute path to the ${subject} Defaults to the current working directory.`,
    );
}

/**
 * Extract `installDir` from a tool-call args bag and default to `process.cwd()`
 * when omitted. Every read-only tool here repeats this exact two-step shape
 * (`(args ?? {}) as { installDir?: string }` followed by `?? process.cwd()`).
 */
function resolveInstallDir(args: unknown): string {
  const { installDir } = (args ?? {}) as { installDir?: string };
  return installDir ?? process.cwd();
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
        installDir: installDirField('to inspect'),
      },
    },
    async (args: unknown) => {
      const result: DetectResult = await runDetect(resolveInstallDir(args));
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
        installDir: installDirField('to inspect'),
      },
    },
    async (args: unknown) => {
      const result: StatusResult = await runStatus(resolveInstallDir(args));
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
        installDir: installDirField('to plan against'),
      },
    },
    async (args: unknown) => {
      const result: PlanResult = await runPlan(resolveInstallDir(args));
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
        installDir: installDirField('to verify'),
      },
    },
    async (args: unknown) => {
      const result: VerifyResult = await runVerify(resolveInstallDir(args));
      return jsonContent(result);
    },
  );

  // -- get_event_plan -----------------------------------------------------
  server.registerTool(
    'get_event_plan',
    {
      title: 'Get approved event plan',
      description:
        'Read the persisted event taxonomy the wizard saved after ' +
        '`confirm_event_plan` (canonical `.amplitude/events.json` or ' +
        'legacy paths). Returns `{ events: [{ name, description }], count }`. ' +
        'Read-only — does not modify the project.',
      inputSchema: {
        installDir: installDirField(''),
      },
    },
    (args: unknown) => {
      const result: EventPlanReadResult = runGetEventPlan(
        resolveInstallDir(args),
      );
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

  // -- record_dashboard_plan ----------------------------------------------
  // Mirrors the in-process `wizard-tools:record_dashboard_plan` so a host AI
  // agent driving the wizard via stdio MCP can persist the same artifact.
  // PR 2 of DEFER_DASHBOARD_PLAN.md introduces this; PR 3 adds the
  // `wizard dashboard` command that consumes it. Additive — no behavior
  // change for existing flows.
  server.registerTool(
    'record_dashboard_plan',
    {
      title: 'Record a dashboard plan',
      description:
        'Persist a dashboard plan (charts + dashboard wrapper + the events ' +
        'they reference) to `<installDir>/.amplitude/dashboard-plan.json`. ' +
        'A separate `wizard dashboard` command reads this file later to ' +
        'create the actual charts and dashboard in Amplitude once event ' +
        'ingestion has caught up. `planId` and `createdAt` are stamped by ' +
        'the wizard. Returns the persisted plan on success.',
      inputSchema: {
        installDir: installDirField('to write the plan into'),
        plan: DashboardPlanInputSchema.describe(
          'The plan body. Must include orgId, projectId, events, charts, and dashboard. `version`, `planId`, and `createdAt` are stamped by the writer.',
        ),
      },
    },
    (args: unknown) => {
      const { plan } = (args ?? {}) as { plan: DashboardPlanInput };
      const persisted = writeDashboardPlan(resolveInstallDir(args), plan);
      if (!persisted) {
        return jsonContent({
          ok: false,
          error:
            'failed to persist dashboard plan — see wizard log for details',
        });
      }
      return jsonContent({ ok: true, plan: persisted });
    },
  );

  // -- get_dashboard_plan -------------------------------------------------
  // Read-only counterpart to `record_dashboard_plan`. Lets the host agent
  // inspect the persisted plan (e.g. to decide whether to invoke the
  // deferred `wizard dashboard` command) without parsing the file itself.
  server.registerTool(
    'get_dashboard_plan',
    {
      title: 'Get the persisted dashboard plan',
      description:
        'Read `<installDir>/.amplitude/dashboard-plan.json` if it exists. ' +
        'Returns `{ plan }` on success, `{ plan: null }` if the file is ' +
        'missing, unreadable, or fails schema validation. Safe to call ' +
        'repeatedly — does not write anything.',
      inputSchema: {
        installDir: installDirField('to inspect'),
      },
    },
    (args: unknown) => {
      const plan = readDashboardPlan(resolveInstallDir(args));
      return jsonContent({ plan });
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

  const rawServer = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // Wrap with Sentry auto-instrumentation BEFORE registering tools so every
  // tool call gets a span automatically. Wrapping is a no-op when telemetry
  // is disabled — returns the raw server unchanged.
  const server = wrapMcpServerWithSentry(rawServer);

  registerWizardTools(server as unknown as WizardMcpToolRegistrar);

  const transport = new StdioServerTransport();

  let shuttingDown = false;
  const shutdown = async (exitCode = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      // Awaiting server.close() lets in-flight tool calls finish their
      // current write before the transport tears down, instead of being
      // truncated mid-response when the kernel signal lands.
      await server.close();
    } catch {
      /* ignore close errors during shutdown */
    }
    process.exit(exitCode);
  };

  // Use awaited async handlers so any rejection inside shutdown surfaces
  // as a logged failure rather than an unhandled-promise warning. The
  // prior `void shutdown(0)` form discarded errors silently and could
  // race the close() call against process.exit().
  const handleSignal = (signal: NodeJS.Signals): void => {
    void (async () => {
      try {
        await shutdown(0);
      } catch (err) {
        process.stderr.write(
          `amplitude-wizard mcp serve: shutdown after ${signal} failed: ${
            err instanceof Error ? err.message : String(err)
          }\n`,
        );
        process.exit(1);
      }
    })();
  };
  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));

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
