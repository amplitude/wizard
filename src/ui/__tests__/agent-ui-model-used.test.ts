/**
 * Regression suite for PR B9 — `model_used` orchestrator-facing
 * model-awareness event.
 *
 * Four layers of coverage:
 *
 *  1. `AgentUI.emitModelUsed` envelope shape on stdout —
 *     `type: 'lifecycle'`, `data.event: 'model_used'`, the registered
 *     `data_version`, the full payload (model, modelDisplay, modelTier,
 *     context).
 *
 *  2. `classifyModelTier` / `formatModelDisplay` pure-function coverage
 *     across every Claude family alias the wizard emits (Sonnet 4.6,
 *     Opus 4.7, Haiku 4.5, the gateway-prefixed forms, dated suffix
 *     forms) plus the `'other'` fallback for unknown aliases.
 *
 *  3. Dedup behaviour — the same `(model, context)` pair only fires
 *     once per AgentUI instance; the same model in a different context
 *     fires a second event; different models in the same context fire
 *     a second event.
 *
 *  4. No-op behaviour on non-AgentUI implementations (LoggingUI) and
 *     stream silence on runs that never emit the event.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentUI } from '../agent-ui.js';
import {
  EVENT_DATA_VERSIONS,
  classifyModelTier,
  formatModelDisplay,
} from '../../lib/agent-events.js';

interface NDJSONEvent {
  v: 1;
  '@timestamp': string;
  type: string;
  message: string;
  session_id?: string;
  run_id?: string;
  data?: Record<string, unknown>;
  data_version?: number;
  level?: string;
}

const setupStdoutSpy = (): { writes: string[]; restore: () => void } => {
  const writes: string[] = [];
  const spy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
  return { writes, restore: () => spy.mockRestore() };
};

const parseEvents = (writes: string[]): NDJSONEvent[] =>
  writes.map((w) => JSON.parse(w.trim()) as NDJSONEvent);

const findModelUsed = (writes: string[]): NDJSONEvent[] =>
  parseEvents(writes).filter(
    (e) => (e.data as { event?: string } | undefined)?.event === 'model_used',
  );

// ── AgentUI envelope: emitModelUsed ────────────────────────────────────

describe('AgentUI.emitModelUsed (PR B9: model-awareness lifecycle)', () => {
  let writes: string[];
  let restore: () => void;

  beforeEach(() => {
    ({ writes, restore } = setupStdoutSpy());
  });
  afterEach(() => restore());

  it('emits a lifecycle envelope with data.event = "model_used"', () => {
    const ui = new AgentUI();
    ui.emitModelUsed?.({
      model: 'claude-sonnet-4-6',
      modelDisplay: 'Sonnet 4.6',
      modelTier: 'sonnet',
      context: 'inner_agent',
    });
    const events = findModelUsed(writes);
    expect(events.length).toBe(1);
    const event = events[0];
    expect(event.v).toBe(1);
    expect(event.type).toBe('lifecycle');
    expect(event.data).toMatchObject({
      event: 'model_used',
      model: 'claude-sonnet-4-6',
      modelDisplay: 'Sonnet 4.6',
      modelTier: 'sonnet',
      context: 'inner_agent',
    });
  });

  it('stamps the registered data_version for model_used', () => {
    const ui = new AgentUI();
    ui.emitModelUsed?.({
      model: 'claude-sonnet-4-6',
      modelDisplay: 'Sonnet 4.6',
      modelTier: 'sonnet',
      context: 'inner_agent',
    });
    const event = findModelUsed(writes)[0];
    expect(event.data_version).toBe(EVENT_DATA_VERSIONS.model_used);
    // Pin the v1 baseline so a future bump that lands here lights
    // up this test as the canary.
    expect(event.data_version).toBe(1);
  });

  it('preserves @timestamp as an ISO string', () => {
    const ui = new AgentUI();
    ui.emitModelUsed?.({
      model: 'claude-haiku-4-5-20251001',
      modelDisplay: 'Haiku 4.5',
      modelTier: 'haiku',
      context: 'classifier',
    });
    const event = findModelUsed(writes)[0];
    expect(typeof event['@timestamp']).toBe('string');
    expect(() => new Date(event['@timestamp'])).not.toThrow();
  });

  it('carries a human-readable summary in `message`', () => {
    // The message field is the log-scraping fallback for tools that
    // don't unwrap `data`. Pin its shape so a future refactor that
    // drops the tier or context from the summary string gets caught.
    const ui = new AgentUI();
    ui.emitModelUsed?.({
      model: 'claude-sonnet-4-6',
      modelDisplay: 'Sonnet 4.6',
      modelTier: 'sonnet',
      context: 'inner_agent',
    });
    const event = findModelUsed(writes)[0];
    expect(event.message).toContain('model_used');
    expect(event.message).toContain('inner_agent');
    expect(event.message).toContain('Sonnet 4.6');
    expect(event.message).toContain('sonnet');
  });

  it('emits the gateway-prefixed alias verbatim (preserves routing path)', () => {
    // Orchestrators that branch on "is this the gateway or direct
    // API?" need the raw alias including the `anthropic/` prefix.
    // The display string is normalized; the wire `model` field is
    // not.
    const ui = new AgentUI();
    ui.emitModelUsed?.({
      model: 'anthropic/claude-haiku-4-5-20251001',
      modelDisplay: 'Haiku 4.5',
      modelTier: 'haiku',
      context: 'classifier',
    });
    const event = findModelUsed(writes)[0];
    const data = event.data as { model: string; modelDisplay: string };
    expect(data.model).toBe('anthropic/claude-haiku-4-5-20251001');
    expect(data.modelDisplay).toBe('Haiku 4.5');
  });
});

// ── Pure-function coverage: classifyModelTier ──────────────────────────

describe('classifyModelTier (PR B9: tier bucketing)', () => {
  it('buckets the production Sonnet 4.6 alias', () => {
    expect(classifyModelTier('claude-sonnet-4-6')).toBe('sonnet');
    expect(classifyModelTier('anthropic/claude-sonnet-4-6')).toBe('sonnet');
  });

  it('buckets the Sonnet 4.5 fallback alias', () => {
    // `FALLBACK_MODEL_DIRECT` in model-config.ts pins this alias.
    expect(classifyModelTier('claude-sonnet-4-5')).toBe('sonnet');
    expect(classifyModelTier('anthropic/claude-sonnet-4-5')).toBe('sonnet');
  });

  it('buckets the Haiku 4.5 dated alias', () => {
    // `HAIKU_MODEL_DIRECT` in model-config.ts.
    expect(classifyModelTier('claude-haiku-4-5-20251001')).toBe('haiku');
    expect(classifyModelTier('anthropic/claude-haiku-4-5-20251001')).toBe(
      'haiku',
    );
  });

  it('buckets the Haiku 4.5 bare alias (--mode fast)', () => {
    expect(classifyModelTier('claude-haiku-4-5')).toBe('haiku');
    expect(classifyModelTier('anthropic/claude-haiku-4-5')).toBe('haiku');
  });

  it('buckets the Opus 4.7 alias (--mode thorough)', () => {
    expect(classifyModelTier('claude-opus-4-7')).toBe('opus');
    expect(classifyModelTier('anthropic/claude-opus-4-7')).toBe('opus');
  });

  it('falls back to "other" for unknown aliases', () => {
    // Defensive: an operator overriding WIZARD_CLAUDE_MODEL with a
    // non-Claude alias (or a typo) lands in `'other'` so
    // orchestrators don't mis-tier it.
    expect(classifyModelTier('gpt-4o')).toBe('other');
    expect(classifyModelTier('mistral-large')).toBe('other');
    expect(classifyModelTier('')).toBe('other');
  });

  it('matches opus before sonnet/haiku (precedence guard)', () => {
    // A hypothetical alias containing multiple family substrings
    // should classify by the strongest tier first. The wizard
    // doesn't ship one, but the matcher's precedence is
    // load-bearing: a refactor that flipped sonnet ahead of opus
    // would silently downgrade capability reporting.
    expect(classifyModelTier('claude-opus-haiku-blend-1')).toBe('opus');
  });

  it('is case-insensitive (defensive against override typos)', () => {
    expect(classifyModelTier('CLAUDE-SONNET-4-6')).toBe('sonnet');
    expect(classifyModelTier('Anthropic/Claude-Opus-4-7')).toBe('opus');
  });
});

// ── Pure-function coverage: formatModelDisplay ────────────────────────

describe('formatModelDisplay (PR B9: human-readable label)', () => {
  it('formats the production Claude aliases the wizard emits', () => {
    expect(formatModelDisplay('claude-sonnet-4-6')).toBe('Sonnet 4.6');
    expect(formatModelDisplay('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(formatModelDisplay('claude-opus-4-7')).toBe('Opus 4.7');
  });

  it('strips the anthropic/ gateway prefix before formatting', () => {
    expect(formatModelDisplay('anthropic/claude-sonnet-4-6')).toBe(
      'Sonnet 4.6',
    );
    expect(formatModelDisplay('anthropic/claude-haiku-4-5-20251001')).toBe(
      'Haiku 4.5',
    );
  });

  it('falls back to the raw alias when the shape is unknown', () => {
    // Operator override or non-Claude alias — surface the raw
    // string verbatim instead of fabricating a label.
    expect(formatModelDisplay('gpt-4o')).toBe('gpt-4o');
    expect(formatModelDisplay('mistral-large')).toBe('mistral-large');
  });
});

// ── Dedup behaviour ───────────────────────────────────────────────────

describe('emitModelUsed dedup per (model, context) pair', () => {
  let writes: string[];
  let restore: () => void;

  beforeEach(() => {
    ({ writes, restore } = setupStdoutSpy());
  });
  afterEach(() => restore());

  it('emits exactly one envelope when the same (model, context) fires twice', () => {
    // The inner-agent emit fires on every attempt boundary — a long
    // run with N retries would otherwise spam N model_used events.
    // The dedup keeps the wire clean.
    const ui = new AgentUI();
    const payload = {
      model: 'claude-sonnet-4-6',
      modelDisplay: 'Sonnet 4.6',
      modelTier: 'sonnet' as const,
      context: 'inner_agent' as const,
    };
    ui.emitModelUsed?.(payload);
    ui.emitModelUsed?.(payload);
    ui.emitModelUsed?.(payload);
    expect(findModelUsed(writes).length).toBe(1);
  });

  it('emits two envelopes when the same model fires in two different contexts', () => {
    // A Haiku probe at startup AND a Haiku slash-console call mid-run
    // are two distinct subsystem announcements — orchestrators want
    // to see both so they can attribute the model to the right
    // subsystem. Only EXACT (model, context) repeats get suppressed.
    const ui = new AgentUI();
    const model = 'claude-haiku-4-5-20251001';
    const modelDisplay = 'Haiku 4.5';
    const modelTier = 'haiku' as const;
    ui.emitModelUsed?.({
      model,
      modelDisplay,
      modelTier,
      context: 'classifier',
    });
    ui.emitModelUsed?.({
      model,
      modelDisplay,
      modelTier,
      context: 'inner_agent',
    });
    const events = findModelUsed(writes);
    expect(events.length).toBe(2);
    const contexts = events.map((e) => (e.data as { context: string }).context);
    expect(new Set(contexts)).toEqual(new Set(['classifier', 'inner_agent']));
  });

  it('emits two envelopes when different models fire in the same context', () => {
    // A future attempt that switches to the SDK fallback alias
    // (Sonnet 4.5) after a primary failure should emit a second
    // `model_used` so orchestrators can attribute the new tier.
    const ui = new AgentUI();
    ui.emitModelUsed?.({
      model: 'claude-sonnet-4-6',
      modelDisplay: 'Sonnet 4.6',
      modelTier: 'sonnet',
      context: 'inner_agent',
    });
    ui.emitModelUsed?.({
      model: 'claude-sonnet-4-5',
      modelDisplay: 'Sonnet 4.5',
      modelTier: 'sonnet',
      context: 'inner_agent',
    });
    const events = findModelUsed(writes);
    expect(events.length).toBe(2);
    const models = events.map((e) => (e.data as { model: string }).model);
    expect(models).toEqual(['claude-sonnet-4-6', 'claude-sonnet-4-5']);
  });

  it('resets dedup state per AgentUI instance', () => {
    // The dedup set is instance-scoped — a fresh AgentUI (e.g. in
    // a test) starts with an empty set so the wire matches the
    // expected first-of-run announcement.
    const payload = {
      model: 'claude-opus-4-7',
      modelDisplay: 'Opus 4.7',
      modelTier: 'opus' as const,
      context: 'inner_agent' as const,
    };
    const ui1 = new AgentUI();
    ui1.emitModelUsed?.(payload);
    ui1.emitModelUsed?.(payload);
    expect(findModelUsed(writes).length).toBe(1);

    const ui2 = new AgentUI();
    ui2.emitModelUsed?.(payload);
    expect(findModelUsed(writes).length).toBe(2);
  });
});

// ── No-op surface on non-AgentUI implementations ───────────────────────

describe('emitModelUsed no-op on non-AgentUI implementations', () => {
  it('is optional on the WizardUI base interface (LoggingUI does not implement)', async () => {
    // Only AgentUI emits this event. The optional method signature
    // on WizardUI is the load-bearing contract that lets the
    // inner-agent attempt boundary and the classifier call sites
    // invoke `getUI().emitModelUsed?.()` without crashing in TUI /
    // CI mode.
    const { LoggingUI } = await import('../logging-ui.js');
    const logging = new LoggingUI();
    expect(
      (logging as unknown as { emitModelUsed?: unknown }).emitModelUsed,
    ).toBeUndefined();
  });
});

// ── Stream silence on non-model-related runs ───────────────────────────

describe('model_used absence on non-model-related stream activity', () => {
  let writes: string[];
  let restore: () => void;

  beforeEach(() => {
    ({ writes, restore } = setupStdoutSpy());
  });
  afterEach(() => restore());

  it('does not appear on the wire when no call site emits', () => {
    // The model_used event is observational — only call sites that
    // know which model they're routing to emit. Verify the wire
    // stays clean unless an emitter explicitly fires.
    const ui = new AgentUI();
    ui.startRun();
    ui.emitRunPhase('cold_start');
    ui.emitToolCall({ tool: 'Edit' });
    ui.recordToolOutcome('Edit', 'success');
    ui.emitToolCallSummary?.();
    expect(findModelUsed(writes)).toEqual([]);
  });
});

// ── Envelope validator round-trip ──────────────────────────────────────

describe('model_used — envelope validator round-trip', () => {
  let writes: string[];
  let restore: () => void;

  beforeEach(() => {
    ({ writes, restore } = setupStdoutSpy());
  });
  afterEach(() => restore());

  it('produces an envelope that JSON.parse round-trips cleanly', () => {
    const ui = new AgentUI();
    ui.emitModelUsed?.({
      model: 'claude-sonnet-4-6',
      modelDisplay: 'Sonnet 4.6',
      modelTier: 'sonnet',
      context: 'inner_agent',
    });
    expect(writes.length).toBeGreaterThanOrEqual(1);
    const rawLine = writes[writes.length - 1];
    expect(rawLine.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(rawLine.trim()) as NDJSONEvent;
    expect(parsed.v).toBe(1);
    expect(typeof parsed['@timestamp']).toBe('string');
    expect(parsed.type).toBe('lifecycle');
    expect(typeof parsed.data_version).toBe('number');
    const data = parsed.data as {
      event: string;
      model: string;
      modelDisplay: string;
      modelTier: string;
      context: string;
    };
    expect(data.event).toBe('model_used');
    expect(typeof data.model).toBe('string');
    expect(typeof data.modelDisplay).toBe('string');
    expect(['haiku', 'sonnet', 'opus', 'other']).toContain(data.modelTier);
    expect(['inner_agent', 'classifier', 'taxonomy']).toContain(data.context);
  });

  it('survives the agent-ui envelope validator (data_version matches registry)', () => {
    // The agent-ui wire boundary runs `validateEnvelopeOrLog` on
    // every emit. The coherence check inside that validator asserts
    // `data_version === EVENT_DATA_VERSIONS[data.event]` — pinning
    // the registry value here protects against a future bump that
    // updates the registry without bumping the emitter (or vice
    // versa).
    const ui = new AgentUI();
    ui.emitModelUsed?.({
      model: 'claude-opus-4-7',
      modelDisplay: 'Opus 4.7',
      modelTier: 'opus',
      context: 'inner_agent',
    });
    const event = findModelUsed(writes)[0];
    expect(event.data_version).toBe(EVENT_DATA_VERSIONS.model_used);
    expect(event.v).toBe(1);
  });
});
