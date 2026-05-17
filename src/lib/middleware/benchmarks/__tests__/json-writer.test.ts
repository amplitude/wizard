/**
 * Golden snapshot test for JsonWriterPlugin.
 *
 * The benchmark JSON is consumed by external tools (release scripts,
 * regression dashboards, ad-hoc CI parsers). Treat the shape as a contract:
 * any field rename / reordering / type change should be a deliberate
 * decision, surfaced in PR review via a snapshot diff.
 *
 * The plugin assembles its output from the upstream plugin store entries
 * (tokens, cache, turns, cost, duration, compactions, contextSize). We
 * fake those entries directly via a context stub — the goal is to pin the
 * BenchmarkData envelope shape, not to re-test every producer's math.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../../../../ui', () => ({
  getUI: () => ({ log: { info: vi.fn() } }),
}));
vi.mock('../../../../utils/debug', () => ({
  logToFile: vi.fn(),
}));
vi.mock('../../../agent-interface', () => ({
  AgentSignals: { BENCHMARK: '[BENCHMARK]' },
}));

import { JsonWriterPlugin } from '../json-writer';
import type {
  MiddlewareContext,
  MiddlewareStore,
  SDKMessage,
} from '../../types';
import type { BenchmarkData } from '../../benchmark';

function ctxFromStore(
  data: Record<string, unknown>,
  currentPhase = '1.3-conclude',
): MiddlewareContext {
  return {
    currentPhase,
    currentPhaseFreshContext: false,
    get<T>(key: string): T | undefined {
      return data[key] as T | undefined;
    },
  };
}

const noopStore: MiddlewareStore = { set: () => undefined };

describe('JsonWriterPlugin — golden BenchmarkData snapshot', () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = path.join(os.tmpdir(), `wizard-benchmark-${Date.now()}.json`);
  });

  it('emits the canonical BenchmarkData shape downstream tools depend on', () => {
    const ctx = ctxFromStore({
      turns: {
        isDuplicate: false,
        phaseTurns: 0,
        totalTurns: 12,
        phaseSnapshots: [
          { phase: '1.0-begin', turns: 4 },
          { phase: '1.1-edit', turns: 8 },
        ],
      },
      tokens: {
        phaseInput: 0,
        phaseOutput: 0,
        totalInput: 1500,
        totalOutput: 400,
        lastUsage: null,
        phaseSnapshots: [
          {
            phase: '1.0-begin',
            inputTokens: 600,
            outputTokens: 150,
            messagesWithUsage: 4,
          },
          {
            phase: '1.1-edit',
            inputTokens: 900,
            outputTokens: 250,
            messagesWithUsage: 8,
          },
        ],
      },
      cache: {
        phaseRead: 0,
        phaseCreation: 0,
        totalRead: 500,
        totalCreation: 0,
        totalCreation5m: 0,
        totalCreation1h: 0,
        phaseSnapshots: [
          {
            phase: '1.0-begin',
            cacheReadTokens: 200,
            cacheCreationTokens: 0,
            cacheCreation5m: 0,
            cacheCreation1h: 0,
          },
          {
            phase: '1.1-edit',
            cacheReadTokens: 300,
            cacheCreationTokens: 100,
            cacheCreation5m: 80,
            cacheCreation1h: 20,
          },
        ],
      },
      cost: {
        totalCost: 0.0123,
        phaseCosts: [
          { phase: '1.0-begin', cost: 0.005 },
          { phase: '1.1-edit', cost: 0.0073 },
        ],
      },
      duration: {
        totalDurationMs: 60000,
        phaseSnapshots: [
          {
            phase: '1.0-begin',
            startTime: 1000,
            endTime: 21000,
            durationMs: 20000,
          },
          {
            phase: '1.1-edit',
            startTime: 21000,
            endTime: 61000,
            durationMs: 40000,
          },
        ],
      },
      compactions: {
        phaseCompactions: 0,
        phasePreTokens: [],
        totalCompactions: 1,
        phaseSnapshots: [
          { phase: '1.0-begin', compactions: 0, preTokens: [] },
          { phase: '1.1-edit', compactions: 1, preTokens: [9000] },
        ],
      },
      contextSize: {
        phaseSnapshots: [
          {
            phase: '1.0-begin',
            contextTokensIn: undefined,
            contextTokensOut: 800,
            freshContext: true,
          },
          {
            phase: '1.1-edit',
            contextTokensIn: 800,
            contextTokensOut: 1300,
            freshContext: false,
          },
        ],
      },
    });

    const resultMessage: SDKMessage = {
      type: 'result',
      num_turns: 12,
      total_cost_usd: 0.0123,
    } as SDKMessage;

    const plugin = new JsonWriterPlugin(tmpPath);
    const out = plugin.onFinalize(resultMessage, 60000, ctx, noopStore);

    // Drop the volatile timestamp before snapshotting; assert on shape only.
    const { timestamp, ...rest } = out as BenchmarkData;
    expect(typeof timestamp).toBe('string');
    expect(rest).toMatchInlineSnapshot(`
      {
        "steps": [
          {
            "contextTokensOut": 800,
            "durationApiMs": 0,
            "durationMs": 20000,
            "modelUsage": {},
            "name": "1.0-begin",
            "numTurns": 4,
            "totalCostUsd": 0.005,
            "usage": {
              "cache_creation_input_tokens": 0,
              "cache_read_input_tokens": 200,
              "input_tokens": 600,
              "output_tokens": 150,
            },
          },
          {
            "compactionPreTokens": [
              9000,
            ],
            "compactions": 1,
            "contextTokensIn": 800,
            "contextTokensOut": 1300,
            "durationApiMs": 0,
            "durationMs": 40000,
            "modelUsage": {},
            "name": "1.1-edit",
            "numTurns": 8,
            "totalCostUsd": 0.0073,
            "usage": {
              "cache_creation": {
                "ephemeral_1h_input_tokens": 20,
                "ephemeral_5m_input_tokens": 80,
              },
              "cache_creation_input_tokens": 100,
              "cache_read_input_tokens": 300,
              "input_tokens": 900,
              "output_tokens": 250,
            },
          },
        ],
        "totals": {
          "durationMs": 60000,
          "inputTokens": 2000,
          "numTurns": 12,
          "outputTokens": 400,
          "totalCacheCreation1hTokens": 0,
          "totalCacheCreation5mTokens": 0,
          "totalCacheReadTokens": 500,
          "totalCompactions": 1,
          "totalCostUsd": 0.0123,
        },
      }
    `);

    // Also pin the actual on-disk JSON so a downstream parser regression
    // would surface as a diff rather than a silent shape change.
    const writtenRaw = fs.readFileSync(tmpPath, 'utf-8');
    const written = JSON.parse(writtenRaw) as BenchmarkData;
    expect(typeof written.timestamp).toBe('string');
    expect({ ...written, timestamp: '<ISO>' }).toMatchInlineSnapshot(`
      {
        "steps": [
          {
            "contextTokensOut": 800,
            "durationApiMs": 0,
            "durationMs": 20000,
            "modelUsage": {},
            "name": "1.0-begin",
            "numTurns": 4,
            "totalCostUsd": 0.005,
            "usage": {
              "cache_creation_input_tokens": 0,
              "cache_read_input_tokens": 200,
              "input_tokens": 600,
              "output_tokens": 150,
            },
          },
          {
            "compactionPreTokens": [
              9000,
            ],
            "compactions": 1,
            "contextTokensIn": 800,
            "contextTokensOut": 1300,
            "durationApiMs": 0,
            "durationMs": 40000,
            "modelUsage": {},
            "name": "1.1-edit",
            "numTurns": 8,
            "totalCostUsd": 0.0073,
            "usage": {
              "cache_creation": {
                "ephemeral_1h_input_tokens": 20,
                "ephemeral_5m_input_tokens": 80,
              },
              "cache_creation_input_tokens": 100,
              "cache_read_input_tokens": 300,
              "input_tokens": 900,
              "output_tokens": 250,
            },
          },
        ],
        "timestamp": "<ISO>",
        "totals": {
          "durationMs": 60000,
          "inputTokens": 2000,
          "numTurns": 12,
          "outputTokens": 400,
          "totalCacheCreation1hTokens": 0,
          "totalCacheCreation5mTokens": 0,
          "totalCacheReadTokens": 500,
          "totalCompactions": 1,
          "totalCostUsd": 0.0123,
        },
      }
    `);
  });
});
