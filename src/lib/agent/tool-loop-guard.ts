import { createHash } from 'node:crypto';
import type { HookCallback } from '../agent-hooks';

export const TOOL_LOOP_WARNING =
  'Repeated tool calls returned unchanged results. Use the results already available. Do not repeat the same call or discovery cycle unless an input or the underlying state has changed. Try one different approach, or explain the blocker and what remains unfinished.';
export const TOOL_LOOP_STOP_MESSAGE =
  'Setup stopped because the agent kept repeating tool calls with unchanged results. Changes already made are preserved. Review the changes and any unfinished setup steps before trying again.';

// Only hashes are retained; tool arguments/results can contain source or secrets.
function fingerprint(value: unknown): string | null {
  try {
    const encoded = JSON.stringify(value, (_key, item: unknown) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        return Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        );
      }
      return item;
    });
    if (!encoded || encoded.length > 1_000_000) return null;
    return createHash('sha256').update(encoded).digest('hex');
  } catch {
    return null;
  }
}

function failed(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const value = result as Record<string, unknown>;
  return Boolean(
    value.is_error || value.isError || value.error || value.success === false,
  );
}

/** Per-run, conservative detector for cycles of 1–3 completed tool calls. */
export class ToolLoopGuard {
  private history: string[] = [];
  private seen = new Set<string>();
  private warned = false;
  stopped = false;
  get warning(): string | undefined {
    return this.warned ? TOOL_LOOP_WARNING : undefined;
  }
  reset(): void {
    if (this.stopped) return;
    this.history = [];
    this.seen.clear();
    this.warned = false;
  }
  observe(
    name: string,
    input: unknown,
    result: unknown,
    id?: string,
  ): 'warn' | 'stop' | null {
    if (this.stopped) return null;
    if (id && this.seen.has(id)) return null;
    if (id) {
      this.seen.add(id);
      if (this.seen.size > 64) this.seen.delete(Array.from(this.seen)[0]);
    }
    // Successful writes invalidate prior reads; polling and user-facing
    // interaction are legitimate repetition with their own lifecycle/budgets.
    if (
      !name ||
      result === undefined ||
      ['TaskOutput', 'TodoWrite', 'AskUserQuestion'].includes(name) ||
      /(?:^|__)(confirm|choose|confirm_event_plan|report_status|wizard_feedback)$/.test(
        name,
      ) ||
      (!failed(result) &&
        [
          'Write',
          'Edit',
          'MultiEdit',
          'mcp__wizard-tools__set_env_values',
        ].includes(name))
    ) {
      this.reset();
      return null;
    }
    let args = input;
    if (
      name.startsWith('mcp__wizard-tools__') &&
      input &&
      typeof input === 'object' &&
      !Array.isArray(input)
    ) {
      args = Object.fromEntries(
        Object.entries(input).filter(([key]) => key !== 'reason'),
      );
    }
    const key = fingerprint([name, args, result]);
    if (!key) {
      this.reset();
      return null;
    }
    this.history.push(key);
    this.history = this.history.slice(-12);
    for (let width = 1; width <= 3; width++) {
      let repeats = 1;
      const n = this.history.length;
      while (
        (repeats + 1) * width <= n &&
        this.history
          .slice(n - width, n)
          .every(
            (entry, i) => entry === this.history[n - (repeats + 1) * width + i],
          )
      )
        repeats++;
      if (repeats >= 4 && this.warned) {
        this.stopped = true;
        return 'stop';
      }
      if (repeats >= 3) {
        if (this.warned) return null;
        this.warned = true;
        return 'warn';
      }
    }
    this.warned = false;
    return null;
  }
}

export function createToolLoopHooks(
  guard: ToolLoopGuard,
  onStop: () => void,
): {
  pre: HookCallback;
  post: HookCallback;
  failure: HookCallback;
} {
  const record =
    (event: 'PostToolUse' | 'PostToolUseFailure'): HookCallback =>
    (input, id) => {
      const rawName = input.tool_name ?? input.toolName;
      const action = guard.observe(
        typeof rawName === 'string' ? rawName : '',
        input.tool_input ?? input.toolInput,
        event === 'PostToolUseFailure'
          ? { error: input.error }
          : input.tool_response ?? input.tool_result,
        id ??
          (typeof input.tool_use_id === 'string'
            ? input.tool_use_id
            : undefined),
      );
      if (action === 'stop') {
        onStop();
        return Promise.resolve({
          continue: false,
          stopReason: TOOL_LOOP_STOP_MESSAGE,
        });
      }
      return Promise.resolve(
        action === 'warn'
          ? {
              hookSpecificOutput: {
                hookEventName: event,
                additionalContext: TOOL_LOOP_WARNING,
              },
            }
          : {},
      );
    };
  return {
    pre: () =>
      Promise.resolve(
        guard.stopped
          ? {
              continue: false,
              stopReason: TOOL_LOOP_STOP_MESSAGE,
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: TOOL_LOOP_STOP_MESSAGE,
              },
            }
          : {},
      ),
    post: record('PostToolUse'),
    failure: record('PostToolUseFailure'),
  };
}
