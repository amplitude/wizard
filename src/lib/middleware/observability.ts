/**
 * Observability middleware — always-on instrumentation for agent runs.
 *
 * Unlike benchmark middleware (opt-in via --benchmark), this runs on every
 * wizard session. It feeds Sentry breadcrumbs, structured logs, and
 * lightweight timing data into the observability module.
 *
 * Does NOT duplicate benchmark work — no per-token accounting or JSON export.
 * Focuses on: breadcrumbs, phase timing, tool call tracking, error context.
 */

import type {
  Middleware,
  MiddlewareContext,
  MiddlewareStore,
  SDKMessage,
} from './types';
import { createLogger } from '../observability/logger';
import {
  addBreadcrumb,
  setSentryTag,
  startWizardSpan,
  type WizardSpan,
} from '../observability/sentry';
import { rotateRunId } from '../observability/correlation';
import { analytics } from '../../utils/analytics';
import { getUI } from '../../ui';

const log = createLogger('agent');

/** Lightweight phase timing data (not the full benchmark suite). */
interface PhaseTiming {
  phase: string;
  startedAt: number;
  messageCount: number;
  toolCalls: number;
  span: WizardSpan;
}

export function createObservabilityMiddleware(): Middleware {
  let currentPhaseTiming: PhaseTiming | null = null;
  let runSpan: WizardSpan | null = null;
  let totalToolCalls = 0;
  let totalMessages = 0;
  /**
   * Per-tool invocation counts so the finalize emit can hand
   * orchestrators a "where did the time/cost go" breakdown without
   * forcing them to parse every `progress: tool_call` event. Keys are
   * the SDK's tool-name strings (e.g. `"Read"`, `"Edit"`,
   * `"mcp__amplitude-wizard__check_env_keys"`); values are integer
   * counts. Empty when the run had no tool_use blocks (auth-required
   * early-exits, etc.).
   */
  let toolCallsByTool: Record<string, number> = {};

  return {
    name: 'observability',

    onInit() {
      totalToolCalls = 0;
      totalMessages = 0;
      toolCallsByTool = {};
      // Rotate the run ID so retries get distinct correlation
      rotateRunId();
      log.info('Agent run started');
      addBreadcrumb('agent', 'Agent run started');
      runSpan = startWizardSpan('agent.run', 'agent.run');
    },

    onMessage(
      message: SDKMessage,
      ctx: MiddlewareContext,
      _store: MiddlewareStore,
    ) {
      totalMessages++;

      // Track tool use
      if (message.type === 'assistant' && message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === 'tool_use') {
            totalToolCalls++;
            if (currentPhaseTiming) currentPhaseTiming.toolCalls++;
            const toolName = block.name ?? 'unknown';
            // Increment the per-tool counter alongside the aggregate.
            // Stable across phase transitions — the finalize emit
            // reports the full-run breakdown.
            toolCallsByTool[toolName] = (toolCallsByTool[toolName] ?? 0) + 1;
            log.debug(`Tool call: ${toolName}`, {
              tool: toolName,
              phase: ctx.currentPhase,
            });
            addBreadcrumb('tool', `Tool: ${toolName}`, {
              phase: ctx.currentPhase,
            });
            analytics.wizardCapture('tool call executed', {
              'tool name': toolName,
              'agent phase': ctx.currentPhase,
            });
          }
        }
      }

      // Track errors from SDK
      if (message.is_error || message.type === 'error') {
        const errorMsg =
          message.errors?.join('; ') ?? message.result ?? 'Unknown agent error';
        log.warn(`Agent error: ${errorMsg}`, {
          phase: ctx.currentPhase,
          type: message.type,
          subtype: message.subtype,
        });
        addBreadcrumb('agent', `Error: ${errorMsg}`, {
          phase: ctx.currentPhase,
        });
      }

      // Update phase timing
      if (currentPhaseTiming) {
        currentPhaseTiming.messageCount++;
      }
    },

    onPhaseTransition(
      fromPhase: string,
      toPhase: string,
      _ctx: MiddlewareContext,
      _store: MiddlewareStore,
    ) {
      // Close out the completed phase with timing
      if (currentPhaseTiming) {
        const elapsed = Date.now() - currentPhaseTiming.startedAt;
        log.info(
          `Phase complete: ${fromPhase} → ${toPhase} (${(
            elapsed / 1000
          ).toFixed(1)}s)`,
          {
            from: fromPhase,
            to: toPhase,
            duration_ms: elapsed,
            messages: currentPhaseTiming.messageCount,
            tool_calls: currentPhaseTiming.toolCalls,
          },
        );
        addBreadcrumb('phase', `${fromPhase} → ${toPhase}`, {
          duration_ms: elapsed,
        });
        analytics.wizardCapture('agent phase completed', {
          'from phase': fromPhase,
          'to phase': toPhase,
          'duration ms': elapsed,
          'message count': currentPhaseTiming.messageCount,
          'tool call count': currentPhaseTiming.toolCalls,
        });
        currentPhaseTiming.span.setAttribute('duration_ms', elapsed);
        currentPhaseTiming.span.setAttribute(
          'message_count',
          currentPhaseTiming.messageCount,
        );
        currentPhaseTiming.span.setAttribute(
          'tool_call_count',
          currentPhaseTiming.toolCalls,
        );
        currentPhaseTiming.span.end();
      }

      // Start timing the new phase
      currentPhaseTiming = {
        phase: toPhase,
        startedAt: Date.now(),
        messageCount: 0,
        toolCalls: 0,
        span: startWizardSpan(`agent.phase.${toPhase}`, 'agent.phase', {
          phase: toPhase,
        }),
      };

      setSentryTag('agent_phase', toPhase);
    },

    onFinalize(
      resultMessage: SDKMessage,
      totalDurationMs: number,
      _ctx: MiddlewareContext,
      _store: MiddlewareStore,
    ) {
      const durationSec = (totalDurationMs / 1000).toFixed(1);
      const isError = resultMessage.is_error ?? false;

      log.info(
        `Agent run ${isError ? 'failed' : 'completed'} in ${durationSec}s`,
        {
          duration_ms: totalDurationMs,
          total_messages: totalMessages,
          total_tool_calls: totalToolCalls,
          is_error: isError,
          num_turns: resultMessage.num_turns,
        },
      );

      addBreadcrumb('agent', `Run ${isError ? 'failed' : 'completed'}`, {
        duration_ms: totalDurationMs,
        total_tool_calls: totalToolCalls,
      });

      analytics.wizardCapture('agent run completed', {
        'duration ms': totalDurationMs,
        'total messages': totalMessages,
        'total tool calls': totalToolCalls,
        'is error': isError,
        'num turns': resultMessage.num_turns,
      });

      // Surface aggregated metrics on the NDJSON stream for
      // orchestrators (cost / token / tool-call accounting).
      // AgentUI implements `emitAgentMetrics`; InkUI / LoggingUI
      // are no-ops. Wrapped in try/catch so any UI hiccup doesn't
      // disturb the rest of finalize. Token counts come straight
      // from the SDK's terminal `result` message — `usage` and
      // `total_cost_usd` are populated when the SDK reports them.
      try {
        const usage = resultMessage.usage;
        // Only ship `toolCallsByTool` when there were actual tool
        // calls — empty objects in the NDJSON envelope just bloat the
        // stream and offer no signal. Auth-required / no-op runs that
        // exit before the inner agent fires any tools should land
        // without the field rather than with `{}`.
        const hasToolCalls = Object.keys(toolCallsByTool).length > 0;
        getUI().emitAgentMetrics?.({
          durationMs: totalDurationMs,
          inputTokens: usage?.input_tokens,
          outputTokens: usage?.output_tokens,
          cacheReadInputTokens: usage?.cache_read_input_tokens,
          cacheCreationInputTokens: usage?.cache_creation_input_tokens,
          costUsd: resultMessage.total_cost_usd,
          numTurns: resultMessage.num_turns,
          totalToolCalls,
          totalMessages,
          isError,
          ...(hasToolCalls ? { toolCallsByTool } : {}),
        });
      } catch {
        /* metrics emission must not disturb finalize */
      }

      // Close the final phase span (if any) + the run span.
      if (currentPhaseTiming) {
        currentPhaseTiming.span.end();
        currentPhaseTiming = null;
      }
      if (runSpan) {
        runSpan.setAttribute('duration_ms', totalDurationMs);
        runSpan.setAttribute('total_tool_calls', totalToolCalls);
        runSpan.setAttribute('is_error', isError);
        runSpan.end();
        runSpan = null;
      }

      // Return summary for potential consumption
      return {
        duration_ms: totalDurationMs,
        total_messages: totalMessages,
        total_tool_calls: totalToolCalls,
        is_error: isError,
      };
    },
  };
}
