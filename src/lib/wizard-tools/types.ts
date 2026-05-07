/**
 * Shared error-response shape for wizard tools.
 *
 * Why this exists: when a wizard-tool call fails, the agent historically saw
 * a bare error string (e.g. "no .env file found", "command not allowed"). The
 * model has no way to recover from that kind of message — it will retry the
 * same broken approach, which trips the consecutive-deny circuit breaker in
 * `createPreToolUseHook` and burns the run.
 *
 * Structured guidance gives the agent a deterministic recovery path:
 *
 *   - `error`         — short human-readable description of what went wrong.
 *   - `guidance`      — what the agent should do INSTEAD (1-2 sentences).
 *                       This is the load-bearing field for recovery.
 *   - `suggestedTool` — optional canonical tool to use for this task.
 *   - `suggestedArgs` — optional concrete args for the suggested tool.
 *   - `context`       — extra info (denied path, expected format, cwd, …).
 *
 * The MCP protocol requires text in the `content` array; we serialize the
 * structured payload as a single JSON-encoded text block. The agent SDK
 * forwards `content[0].text` to the model verbatim, so a JSON object the
 * model can parse is functionally equivalent to a structured tool result.
 *
 * Tool consumers that match on plain text (legacy bundled skills,
 * commandments older than this PR) still see a JSON blob, which is
 * harmless — they just don't benefit from the new guidance.
 */
export interface WizardToolErrorResponse {
  /** Always false on the error path. Lets a string-matcher detect failure. */
  success: false;
  /** Short human-readable description of what went wrong. */
  error: string;
  /** What to do INSTEAD (1-2 sentences). The agent's recovery path. */
  guidance: string;
  /** Optional canonical tool name the agent should use for this task. */
  suggestedTool?: string;
  /** Optional concrete arguments for the suggested tool. */
  suggestedArgs?: Record<string, unknown>;
  /** Optional context (denied path, expected format, working directory, ...). */
  context?: string;
}

/**
 * Wrap a {@link WizardToolErrorResponse} in the MCP `content` shape every
 * wizard tool uses. Always sets `isError: true` so the agent SDK's
 * tool-result routing knows this turn failed (the SDK adds a
 * `tool_result.is_error: true` flag the model treats specially).
 *
 * The JSON is pretty-printed (2-space indent) for readability when the
 * payload shows up in the agent's transcript or in a debug log. The agent
 * itself doesn't care about the formatting — it just needs the keys.
 */
export function toWizardToolErrorContent(
  response: Omit<WizardToolErrorResponse, 'success'>,
): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
} {
  const payload: WizardToolErrorResponse = {
    success: false,
    ...response,
  };
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
    isError: true,
  };
}

/**
 * Convenience helper for the deny path in `wizardCanUseTool` /
 * `createPreToolUseHook`. Returns a JSON-encoded structured payload as a
 * single string — the SDK's PreToolUse hook contract takes a string for
 * `permissionDecisionReason`, so we pre-serialize here.
 *
 * The agent sees the same shape on a tool deny as it does on a tool error,
 * which means the "read guidance, do not retry" commandment is uniform
 * across both paths.
 */
export function toWizardToolDenyMessage(
  response: Omit<WizardToolErrorResponse, 'success'>,
): string {
  const payload: WizardToolErrorResponse = {
    success: false,
    ...response,
  };
  return JSON.stringify(payload);
}
