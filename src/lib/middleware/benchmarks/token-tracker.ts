/**
 * Token tracking plugin for input/output tokens.
 *
 * Accumulates per-turn token usage (input_tokens + cache_read_input_tokens
 * + cache_creation_input_tokens = total input; output_tokens = output).
 * Respects the dedup flag from TurnCounterPlugin. Cache breakdown (r/5m/1h)
 * is tracked by CacheTrackerPlugin for reporting and pricing.
 */

import type {
  Middleware,
  MiddlewareContext,
  MiddlewareStore,
  SDKMessage,
  SDKUsage,
} from '../types';
import type { TurnData } from './turn-counter';
import { setSpanMeasurement } from '../../observability/index';

export interface TokenData {
  phaseInput: number;
  phaseOutput: number;
  totalInput: number;
  totalOutput: number;
  /** The raw usage object from the last non-duplicate assistant message */
  lastUsage: SDKUsage | null;
  /** Per-phase token snapshots */
  phaseSnapshots: Array<{
    phase: string;
    inputTokens: number;
    outputTokens: number;
    /** Number of turns in this phase that had usage (SDK may not report all) */
    messagesWithUsage: number;
  }>;
}

export class TokenTrackerPlugin implements Middleware {
  readonly name = 'tokens';

  private phaseInput = 0;
  private phaseOutput = 0;
  private totalInput = 0;
  private totalOutput = 0;
  private lastUsage: SDKUsage | null = null;
  private phaseSnapshots: Array<{
    phase: string;
    inputTokens: number;
    outputTokens: number;
    messagesWithUsage: number;
  }> = [];
  private currentPhase = 'setup';
  private phaseMessagesWithUsage = 0;

  onMessage(
    message: SDKMessage,
    ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void {
    if (message.type !== 'assistant') return;

    const turns = ctx.get<TurnData>('turns');
    if (turns?.isDuplicate) return;

    const usage = message.message?.usage;
    if (usage) {
      const input =
        Number(usage.input_tokens ?? 0) +
        Number(usage.cache_read_input_tokens ?? 0) +
        Number(usage.cache_creation_input_tokens ?? 0);
      const output = Number(usage.output_tokens ?? 0);
      this.phaseInput += input;
      this.phaseOutput += output;
      this.totalInput += input;
      this.totalOutput += output;
      this.lastUsage = usage;
      this.phaseMessagesWithUsage += 1;
    }

    store.set('tokens', this.getData());
  }

  onPhaseTransition(
    fromPhase: string,
    toPhase: string,
    _ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void {
    this.phaseSnapshots.push({
      phase: fromPhase,
      inputTokens: this.phaseInput,
      outputTokens: this.phaseOutput,
      messagesWithUsage: this.phaseMessagesWithUsage,
    });
    this.currentPhase = toPhase;
    this.phaseInput = 0;
    this.phaseOutput = 0;
    this.phaseMessagesWithUsage = 0;
    store.set('tokens', this.getData());
  }

  onFinalize(
    resultMessage: SDKMessage,
    _totalDurationMs: number,
    _ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void {
    this.phaseSnapshots.push({
      phase: this.currentPhase,
      inputTokens: this.phaseInput,
      outputTokens: this.phaseOutput,
      messagesWithUsage: this.phaseMessagesWithUsage,
    });
    store.set('tokens', this.getData());

    // Promote token totals to Sentry trace measurements so they show up as
    // first-class metrics in the active root span. No-op when there is no
    // active span or telemetry is disabled — purely additive to benchmark
    // JSON, never replaces it.
    //
    // We prefer the resultMessage's `usage` (cumulative SDK total) when
    // present so input + cache breakdowns survive even if individual
    // assistant deltas were missed. Fall back to the running totals.
    const usage = resultMessage.usage ?? this.lastUsage ?? null;
    if (usage) {
      setSpanMeasurement(
        'agent.tokens.input',
        Number(usage.input_tokens ?? 0),
        'token',
      );
      setSpanMeasurement(
        'agent.tokens.output',
        Number(usage.output_tokens ?? 0),
        'token',
      );
      setSpanMeasurement(
        'agent.tokens.cache_read_input',
        Number(usage.cache_read_input_tokens ?? 0),
        'token',
      );
      setSpanMeasurement(
        'agent.tokens.cache_creation_input',
        Number(usage.cache_creation_input_tokens ?? 0),
        'token',
      );
    }
    // Always emit the wizard-side totals (input includes cache reads + creates,
    // matching how the rest of the wizard reports token spend).
    setSpanMeasurement('agent.tokens.total_input', this.totalInput, 'token');
    setSpanMeasurement('agent.tokens.total_output', this.totalOutput, 'token');
  }

  private getData(): TokenData {
    return {
      phaseInput: this.phaseInput,
      phaseOutput: this.phaseOutput,
      totalInput: this.totalInput,
      totalOutput: this.totalOutput,
      lastUsage: this.lastUsage,
      phaseSnapshots: [...this.phaseSnapshots],
    };
  }
}
