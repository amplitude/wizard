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
import { addBreadcrumb, setSentryTag } from '../observability/sentry';
import { rotateRunId } from '../observability/correlation';
import {
  datadogEvent,
  datadogLog,
  setDatadogTag,
} from '../observability/datadog';

const log = createLogger('agent');

/** Lightweight phase timing data (not the full benchmark suite). */
interface PhaseTiming {
  phase: string;
  startedAt: number;
  messageCount: number;
  toolCalls: number;
}

export function createObservabilityMiddleware(): Middleware {
  let currentPhaseTiming: PhaseTiming | null = null;
  let totalToolCalls = 0;
  let totalMessages = 0;

  return {
    name: 'observability',

    onInit() {
      totalToolCalls = 0;
      totalMessages = 0;
      rotateRunId();
      log.info('Agent run started');
      addBreadcrumb('agent', 'Agent run started');
      datadogEvent('agent.run.started');
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
            log.debug(`Tool call: ${toolName}`, {
              tool: toolName,
              phase: ctx.currentPhase,
            });
            addBreadcrumb('tool', `Tool: ${toolName}`, {
              phase: ctx.currentPhase,
            });
            datadogLog('debug', 'agent.tool', `Tool: ${toolName}`, {
              tool: toolName,
              phase: ctx.currentPhase,
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
        datadogEvent('agent.phase.completed', {
          from: fromPhase,
          to: toPhase,
          duration_ms: elapsed,
          messages: currentPhaseTiming.messageCount,
          tool_calls: currentPhaseTiming.toolCalls,
        });
      }

      // Start timing the new phase
      currentPhaseTiming = {
        phase: toPhase,
        startedAt: Date.now(),
        messageCount: 0,
        toolCalls: 0,
      };

      setSentryTag('agent_phase', toPhase);
      setDatadogTag('agent_phase', toPhase);
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

      datadogEvent(`agent.run.${isError ? 'failed' : 'completed'}`, {
        duration_ms: totalDurationMs,
        total_messages: totalMessages,
        total_tool_calls: totalToolCalls,
        is_error: isError,
        num_turns: resultMessage.num_turns,
      });

      return {
        duration_ms: totalDurationMs,
        total_messages: totalMessages,
        total_tool_calls: totalToolCalls,
        is_error: isError,
      };
    },
  };
}
