// Agent hook definitions that are supported by the Anthropic SDK.
// See docs/flows.md for flow details.
//
// SDK types are mirrored locally to avoid ESM/CJS import issues with
// @anthropic-ai/claude-agent-sdk (which is dynamically imported elsewhere).

/** Mirror of HookEvent from @anthropic-ai/claude-agent-sdk */
export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Notification'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Stop'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PreCompact'
  | 'PermissionRequest';

/** Mirror of HookCallback from @anthropic-ai/claude-agent-sdk */
export type HookCallback = (
  input: Record<string, unknown>,
  toolUseID: string | undefined,
  options: { signal: AbortSignal },
) => Promise<Record<string, unknown>>;

/** Mirror of HookCallbackMatcher from @anthropic-ai/claude-agent-sdk */
export interface HookCallbackMatcher {
  matcher?: string;
  hooks: HookCallback[];
  timeout?: number;
}

export interface AgentHook {
  name: HookEvent;
  pre: boolean;
  implemented: boolean;
  description: string;
  notes: string;
}

export const agentHooks: AgentHook[] = [
  {
    name: 'PreToolUse',
    pre: true,
    implemented: true,
    description: 'Tool call request (can block or modify)',
    notes: 'Block dangerous shell commands',
  },
  {
    name: 'PostToolUse',
    pre: true,
    implemented: true,
    description: 'Tool execution result',
    notes: 'Log all file changes to audit trail',
  },
  {
    name: 'PostToolUseFailure',
    pre: true,
    implemented: true,
    description: 'Tool execution failure',
    notes: 'Handle or log tool errors',
  },
  {
    name: 'UserPromptSubmit',
    pre: true,
    implemented: true,
    description: 'User prompt submission',
    notes: 'Inject additional context into prompts',
  },
  {
    name: 'Stop',
    pre: true,
    implemented: true,
    description: 'Agent execution stop',
    notes: 'Drain feature queue, collect remark, then allow stop',
  },
  {
    name: 'SubagentStart',
    pre: true,
    implemented: true,
    description: 'Subagent initialization',
    notes: 'Track parallel task spawning',
  },
  {
    name: 'SubagentStop',
    pre: true,
    implemented: true,
    description: 'Subagent completion',
    notes: 'Aggregate results from parallel tasks',
  },
  {
    name: 'PreCompact',
    pre: true,
    implemented: true,
    description: 'Conversation compaction request',
    notes: 'Archive full transcript before summarizing',
  },
  {
    name: 'PermissionRequest',
    pre: true,
    implemented: true,
    description: 'Permission dialog would be displayed',
    notes: 'Custom permission handling',
  },
  {
    name: 'SessionStart',
    pre: false,
    implemented: true,
    description: 'Session initialization',
    notes: 'Initialize logging and telemetry',
  },
  {
    name: 'SessionEnd',
    pre: false,
    implemented: true,
    description: 'Session termination',
    notes: 'Clean up temporary resources',
  },
  {
    name: 'Notification',
    pre: true,
    implemented: true,
    description: 'Agent status messages',
    notes: 'Send agent status updates to Slack or PagerDuty',
  },
];

// Stop runs at the end of every agent turn AND at end of run; the model
// uses it to write a reflection / drain the additional-feature queue
// (Slack/MCP install opt-ins, etc). Production logs showed reflections
// regularly burning the full 30s budget — perceived as "frozen" by the
// user right at the moment of "we're done!". 8s is the empirical 95p
// for the queue-drain happy path. If the model overruns we'd rather
// abort the reflection than make the user wait through what looks like
// a stalled outro.
const HOOK_TIMEOUTS: Partial<Record<HookEvent, number>> = {
  Stop: 8,
};

/**
 * Builds the SDK hooks config from the implemented agentHooks registry.
 * Only hooks present in both the registry (implemented: true) and the
 * callbacks map are included in the output.
 */
export function buildHooksConfig(
  callbacks: Partial<Record<HookEvent, HookCallback>>,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const config: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};

  for (const hook of agentHooks.filter((h) => h.implemented)) {
    const callback = callbacks[hook.name];
    if (!callback) continue;

    const timeout = HOOK_TIMEOUTS[hook.name];
    const matcher: HookCallbackMatcher = {
      hooks: [callback],
      ...(timeout !== undefined && { timeout }),
    };
    config[hook.name] = [matcher];
  }

  return config;
}
