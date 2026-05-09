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
import {
  buildStatusEnvelope,
  buildLastStoppingPointEnvelope,
  buildTasksEnvelope,
  buildTaskEnvelope,
  buildSessionsEnvelope,
  buildSessionEnvelope,
  buildChoicesEnvelope,
  buildChoiceEnvelope,
  buildVerificationsEnvelope,
  buildVerificationEnvelope,
  buildMcpCapabilitiesEnvelope,
  buildMcpCapabilityEnvelope,
  asTaskId,
  asSessionId,
  asChoiceId,
  asVerificationId,
  asMcpAppCapabilityId,
} from './orchestration/envelopes.js';
import { TaskLifecycle } from './orchestration/lifecycle.js';
import { ChoiceStatus } from './orchestration/checkpoints/choices.js';
import { VerificationStatus } from './orchestration/checkpoints/verifications.js';
import { McpAppCapabilityState } from './orchestration/mcp-app-lifecycle.js';

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
        installDir: z
          .string()
          .optional()
          .describe(
            'Absolute path to the project. Defaults to the current working directory.',
          ),
      },
    },
    (args: unknown) => {
      const { installDir } = (args ?? {}) as { installDir?: string };
      const result: EventPlanReadResult = runGetEventPlan(
        installDir ?? process.cwd(),
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
        installDir: z
          .string()
          .optional()
          .describe(
            'Absolute path to the project to write the plan into. Defaults to the current working directory.',
          ),
        plan: DashboardPlanInputSchema.describe(
          'The plan body. Must include orgId, projectId, events, charts, and dashboard. `version`, `planId`, and `createdAt` are stamped by the writer.',
        ),
      },
    },
    (args: unknown) => {
      const { installDir, plan } = (args ?? {}) as {
        installDir?: string;
        plan: DashboardPlanInput;
      };
      const persisted = writeDashboardPlan(installDir ?? process.cwd(), plan);
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
        installDir: z
          .string()
          .optional()
          .describe(
            'Absolute path to the project to inspect. Defaults to the current working directory.',
          ),
      },
    },
    (args: unknown) => {
      const { installDir } = (args ?? {}) as { installDir?: string };
      const plan = readDashboardPlan(installDir ?? process.cwd());
      return jsonContent({ plan });
    },
  );

  // ── Orchestration tools (PR 3) ──────────────────────────────────────
  //
  // Read-only mirror of the orchestration CLI surface. Every tool here
  // returns the SAME Zod-validated envelope the matching `wizard …
  // --json` command emits, so a host AI agent can choose either surface
  // without re-shaping the response.
  //
  // Strictly read-only by construction: every handler delegates to
  // builders in `orchestration/envelopes.ts`. The mutators that exist on
  // `OrchestrationStore` (answerChoice, markVerificationStatus,
  // transitionMcpCapability) are deliberately NOT registered — the MCP
  // server's read-only contract (declared in this file's header) stays
  // intact. Hosts that need to mutate orchestration state spawn the CLI
  // (`wizard choice answer …`, `wizard verification mark …`).

  const installDirSchema = z
    .string()
    .optional()
    .describe(
      'Absolute path to the project to inspect. Defaults to the current working directory.',
    );

  // -- get_orchestration_status ------------------------------------------
  server.registerTool(
    'get_orchestration_status',
    {
      title: 'Get orchestration status',
      description:
        'Returns the same envelope `wizard orchestration status --json` ' +
        'emits: store path, store-existence flag, and the full ' +
        'last-stopping-point snapshot (active session, active tasks, ' +
        'pending choices/verifications/MCP actions, recommended next ' +
        'action, resume command). Read-only.',
      inputSchema: { installDir: installDirSchema },
    },
    (args: unknown) => {
      const { installDir } = (args ?? {}) as { installDir?: string };
      const envelope = buildStatusEnvelope({
        installDir: installDir ?? process.cwd(),
      });
      return jsonContent(envelope);
    },
  );

  // -- get_last_stopping_point -------------------------------------------
  server.registerTool(
    'get_last_stopping_point',
    {
      title: 'Get last stopping point',
      description:
        'Returns just the `lastStoppingPoint` snapshot — same data as ' +
        'inside `get_orchestration_status` but without the store-path ' +
        'wrapper. Useful when the agent only needs the next-action / ' +
        'resume command and not the full status payload.',
      inputSchema: { installDir: installDirSchema },
    },
    (args: unknown) => {
      const { installDir } = (args ?? {}) as { installDir?: string };
      const envelope = buildLastStoppingPointEnvelope({
        installDir: installDir ?? process.cwd(),
      });
      return jsonContent(envelope);
    },
  );

  // -- list_tasks --------------------------------------------------------
  server.registerTool(
    'list_tasks',
    {
      title: 'List orchestration tasks',
      description:
        'Returns the same envelope `wizard tasks --json` emits. Optional ' +
        'filters: `state` (queued/running/waiting_for_user/blocked/' +
        'completed/failed/cancelled/superseded), `sessionId`. Read-only.',
      inputSchema: {
        installDir: installDirSchema,
        state: z
          .enum([
            'queued',
            'running',
            'waiting_for_user',
            'blocked',
            'completed',
            'failed',
            'cancelled',
            'superseded',
          ])
          .optional()
          .describe('Filter by lifecycle state.'),
        sessionId: z
          .string()
          .optional()
          .describe('Restrict to tasks owned by this session id.'),
      },
    },
    (args: unknown) => {
      const {
        installDir,
        state,
        sessionId: sessionIdRaw,
      } = (args ?? {}) as {
        installDir?: string;
        state?: TaskLifecycle;
        sessionId?: string;
      };
      const envelope = buildTasksEnvelope({
        installDir: installDir ?? process.cwd(),
        state,
        sessionId: sessionIdRaw ? asSessionId(sessionIdRaw) : undefined,
      });
      return jsonContent(envelope);
    },
  );

  // -- get_task ---------------------------------------------------------
  server.registerTool(
    'get_task',
    {
      title: 'Get orchestration task',
      description:
        'Returns the same envelope `wizard task <id> --json` emits, or ' +
        '{ error: "not_found", id } when the task id is unknown. ' +
        'Read-only.',
      inputSchema: {
        installDir: installDirSchema,
        id: z.string().describe('Task id (e.g. task_<uid>).'),
      },
    },
    (args: unknown) => {
      const { installDir, id } = (args ?? {}) as {
        installDir?: string;
        id: string;
      };
      let taskId;
      try {
        taskId = asTaskId(id);
      } catch (err) {
        return jsonContent({
          error: 'invalid_id',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      const envelope = buildTaskEnvelope({
        installDir: installDir ?? process.cwd(),
        taskId,
      });
      if (!envelope) {
        return jsonContent({ error: 'not_found', id });
      }
      return jsonContent(envelope);
    },
  );

  // -- list_sessions ----------------------------------------------------
  server.registerTool(
    'list_sessions',
    {
      title: 'List wizard sessions',
      description:
        'Returns the same envelope `wizard sessions --json` emits. ' +
        'Read-only.',
      inputSchema: { installDir: installDirSchema },
    },
    (args: unknown) => {
      const { installDir } = (args ?? {}) as { installDir?: string };
      const envelope = buildSessionsEnvelope({
        installDir: installDir ?? process.cwd(),
      });
      return jsonContent(envelope);
    },
  );

  // -- get_session ------------------------------------------------------
  server.registerTool(
    'get_session',
    {
      title: 'Get wizard session',
      description:
        'Returns the same envelope `wizard session <id> --json` emits. ' +
        'Includes the session metadata + every task that belongs to it. ' +
        'Read-only.',
      inputSchema: {
        installDir: installDirSchema,
        id: z.string().describe('Session id (e.g. session_<uid>).'),
      },
    },
    (args: unknown) => {
      const { installDir, id } = (args ?? {}) as {
        installDir?: string;
        id: string;
      };
      let sessionId;
      try {
        sessionId = asSessionId(id);
      } catch (err) {
        return jsonContent({
          error: 'invalid_id',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      const envelope = buildSessionEnvelope({
        installDir: installDir ?? process.cwd(),
        sessionId,
      });
      if (!envelope) {
        return jsonContent({ error: 'not_found', id });
      }
      return jsonContent(envelope);
    },
  );

  // -- list_choices -----------------------------------------------------
  server.registerTool(
    'list_choices',
    {
      title: 'List user-choice checkpoints',
      description:
        'Returns the same envelope `wizard choice list --json` emits. ' +
        "Default filter is `status='pending'`; pass `status='all'` to " +
        'see the full history. Read-only.',
      inputSchema: {
        installDir: installDirSchema,
        status: z
          .enum([
            'pending',
            'answered',
            'expired',
            'cancelled',
            'superseded',
            'all',
          ])
          .optional()
          .describe(
            "Filter by choice status. Defaults to 'pending'. " +
              "Pass 'all' to disable the filter.",
          ),
        sessionId: z.string().optional(),
      },
    },
    (args: unknown) => {
      const {
        installDir,
        status,
        sessionId: sessionIdRaw,
      } = (args ?? {}) as {
        installDir?: string;
        status?: ChoiceStatus | 'all';
        sessionId?: string;
      };
      const effectiveStatus =
        status === 'all' ? undefined : status ?? ChoiceStatus.Pending;
      const envelope = buildChoicesEnvelope({
        installDir: installDir ?? process.cwd(),
        status: effectiveStatus,
        sessionId: sessionIdRaw ? asSessionId(sessionIdRaw) : undefined,
      });
      return jsonContent(envelope);
    },
  );

  // -- get_choice -------------------------------------------------------
  server.registerTool(
    'get_choice',
    {
      title: 'Get a user-choice checkpoint',
      description:
        'Returns the same envelope `wizard choice show <id> --json` ' +
        'emits, or { error: "not_found", id } when unknown. Read-only.',
      inputSchema: {
        installDir: installDirSchema,
        id: z.string().describe('Choice id (e.g. choice_<uid>).'),
      },
    },
    (args: unknown) => {
      const { installDir, id } = (args ?? {}) as {
        installDir?: string;
        id: string;
      };
      let choiceId;
      try {
        choiceId = asChoiceId(id);
      } catch (err) {
        return jsonContent({
          error: 'invalid_id',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      const envelope = buildChoiceEnvelope({
        installDir: installDir ?? process.cwd(),
        choiceId,
      });
      if (!envelope) {
        return jsonContent({ error: 'not_found', id });
      }
      return jsonContent(envelope);
    },
  );

  // -- list_manual_verifications ----------------------------------------
  server.registerTool(
    'list_manual_verifications',
    {
      title: 'List manual-verification checkpoints',
      description:
        'Returns the same envelope `wizard verification list --json` ' +
        'emits. Default filter is `pending` + `failed` (the actionable ' +
        "ones); pass `status='all'` for the full history. Read-only.",
      inputSchema: {
        installDir: installDirSchema,
        status: z
          .enum(['pending', 'passed', 'failed', 'skipped', 'superseded', 'all'])
          .optional(),
        sessionId: z.string().optional(),
      },
    },
    (args: unknown) => {
      const {
        installDir,
        status,
        sessionId: sessionIdRaw,
      } = (args ?? {}) as {
        installDir?: string;
        status?: VerificationStatus | 'all';
        sessionId?: string;
      };
      const effectiveStatus =
        status === 'all'
          ? undefined
          : status
          ? [status]
          : [VerificationStatus.Pending, VerificationStatus.Failed];
      const envelope = buildVerificationsEnvelope({
        installDir: installDir ?? process.cwd(),
        status: effectiveStatus,
        sessionId: sessionIdRaw ? asSessionId(sessionIdRaw) : undefined,
      });
      return jsonContent(envelope);
    },
  );

  // -- get_manual_verification ------------------------------------------
  server.registerTool(
    'get_manual_verification',
    {
      title: 'Get a manual-verification checkpoint',
      description:
        'Returns the same envelope `wizard verification show <id> ' +
        '--json` emits, or { error: "not_found", id } when unknown. ' +
        'Read-only.',
      inputSchema: {
        installDir: installDirSchema,
        id: z.string().describe('Verification id (e.g. verif_<uid>).'),
      },
    },
    (args: unknown) => {
      const { installDir, id } = (args ?? {}) as {
        installDir?: string;
        id: string;
      };
      let verifId;
      try {
        verifId = asVerificationId(id);
      } catch (err) {
        return jsonContent({
          error: 'invalid_id',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      const envelope = buildVerificationEnvelope({
        installDir: installDir ?? process.cwd(),
        verificationId: verifId,
      });
      if (!envelope) {
        return jsonContent({ error: 'not_found', id });
      }
      return jsonContent(envelope);
    },
  );

  // -- list_mcp_capabilities --------------------------------------------
  server.registerTool(
    'list_mcp_capabilities',
    {
      title: 'List MCP-app capabilities',
      description:
        "Returns the orchestration store's record of every MCP capability " +
        '(amplitude / linear / github / sentry / etc.) and its lifecycle ' +
        'state — `available`, `needs_user_choice`, `needs_install`, ' +
        '`installed`, `install_skipped`, etc. Honours the anti-nag ' +
        'invariant — `install_skipped` capabilities surface here for ' +
        'inspection but are NOT meant to be re-prompted. Read-only.',
      inputSchema: {
        installDir: installDirSchema,
        state: z
          .enum([
            'available',
            'needs_user_choice',
            'needs_install',
            'needs_auth',
            'installed',
            'install_skipped',
            'install_failed',
            'auth_failed',
            'superseded',
          ])
          .optional(),
        sessionId: z.string().optional(),
      },
    },
    (args: unknown) => {
      const {
        installDir,
        state,
        sessionId: sessionIdRaw,
      } = (args ?? {}) as {
        installDir?: string;
        state?: McpAppCapabilityState;
        sessionId?: string;
      };
      const envelope = buildMcpCapabilitiesEnvelope({
        installDir: installDir ?? process.cwd(),
        state,
        sessionId: sessionIdRaw ? asSessionId(sessionIdRaw) : undefined,
      });
      return jsonContent(envelope);
    },
  );

  // -- get_mcp_capability -----------------------------------------------
  server.registerTool(
    'get_mcp_capability',
    {
      title: 'Get an MCP-app capability',
      description:
        'Inspect a single MCP capability by id. Returns the typed record ' +
        'including `whyNeeded`, `whatItEnables`, current state, last ' +
        'state-change reason, and user decision (if any). Read-only.',
      inputSchema: {
        installDir: installDirSchema,
        id: z.string().describe('MCP capability id (e.g. mcp_<kind>_<uid>).'),
      },
    },
    (args: unknown) => {
      const { installDir, id } = (args ?? {}) as {
        installDir?: string;
        id: string;
      };
      let capId;
      try {
        capId = asMcpAppCapabilityId(id);
      } catch (err) {
        return jsonContent({
          error: 'invalid_id',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      const envelope = buildMcpCapabilityEnvelope({
        installDir: installDir ?? process.cwd(),
        capabilityId: capId,
      });
      if (!envelope) {
        return jsonContent({ error: 'not_found', id });
      }
      return jsonContent(envelope);
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
