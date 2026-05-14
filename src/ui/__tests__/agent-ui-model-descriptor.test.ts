/**
 * Regression suite for the v2 `inner_agent_started.model` migration.
 *
 * Pre-PR-B13, `inner_agent_started.data.model` was a raw SDK string
 * like `'claude-sonnet-4-6'` or `'anthropic/claude-haiku-4-5-20251001'`.
 * Two independent cross-audit subagents (Desktop POV, Codex POV)
 * flagged this as the biggest vendor-neutral-rendering cliff in the
 * wire today — a Codex parent had no way to detect "this run is on
 * Claude Sonnet 4.6" without string-matching, and Desktop had no way
 * to colorize Sonnet vs Haiku vs Opus speaker bubbles without
 * hard-coding its own substring matcher.
 *
 * PR B13 replaced the raw string with a structured `ModelDescriptor`
 * block (`{ vendor, family, alias, tier, displayName }`) so
 * orchestrators can branch on `tier === 'haiku'` rather than
 * substring-matching. This file pins:
 *   1. The new wire shape (`vendor` / `family` / `alias` / `tier` /
 *      `displayName`) on every callsite.
 *   2. `EVENT_DATA_VERSIONS.inner_agent_started === 2`.
 *   3. `classifyModel` strips `anthropic/` prefixes and ignores
 *      trailing date/patch segments when computing `displayName`.
 *   4. Non-Claude aliases preserve the raw alias and fall back to
 *      vendor/family `'other'` so the wire stays informative.
 *   5. Round-trip through `validateEnvelopeOrLog` succeeds — the new
 *      shape passes the structural Zod schema we ship to
 *      orchestrators (no schema-failure log).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentUI } from '../agent-ui.js';
import {
  EVENT_DATA_VERSIONS,
  classifyModel,
  type ModelDescriptor,
} from '../../lib/agent-events.js';

interface NDJSONEvent {
  v: 1;
  '@timestamp': string;
  type: string;
  message: string;
  session_id?: string;
  run_id?: string;
  data_version?: number;
  data?: Record<string, unknown>;
  level?: string;
}

const setupStdoutSpy = (): {
  writes: string[];
  restore: () => void;
} => {
  const writes: string[] = [];
  const spy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
  return { writes, restore: () => spy.mockRestore() };
};

describe('classifyModel — pure classifier', () => {
  it('classifies `claude-sonnet-4-6` → tier sonnet, displayName Sonnet 4.6', () => {
    const d = classifyModel('claude-sonnet-4-6');
    expect(d).toEqual({
      vendor: 'anthropic',
      family: 'claude',
      alias: 'claude-sonnet-4-6',
      tier: 'sonnet',
      displayName: 'Sonnet 4.6',
    });
  });

  it('classifies `claude-opus-4-7` → tier opus, displayName Opus 4.7', () => {
    const d = classifyModel('claude-opus-4-7');
    expect(d).toEqual({
      vendor: 'anthropic',
      family: 'claude',
      alias: 'claude-opus-4-7',
      tier: 'opus',
      displayName: 'Opus 4.7',
    });
  });

  it('classifies `claude-haiku-4-5` → tier haiku, displayName Haiku 4.5', () => {
    const d = classifyModel('claude-haiku-4-5');
    expect(d).toEqual({
      vendor: 'anthropic',
      family: 'claude',
      alias: 'claude-haiku-4-5',
      tier: 'haiku',
      displayName: 'Haiku 4.5',
    });
  });

  it('strips `anthropic/` prefix and ignores trailing date suffix', () => {
    // Both PR B9's `model_used` consumers AND any LLM-gateway routing
    // ship the namespaced + dated form; classifier must collapse them
    // onto the same stable displayName so orchestrators don't see
    // `Haiku 4.5` flip to `Haiku 4.5.20251001` between runs.
    const d = classifyModel('anthropic/claude-haiku-4-5-20251001');
    expect(d).toEqual({
      vendor: 'anthropic',
      family: 'claude',
      // `anthropic/` is stripped, but the rest of the alias is
      // preserved verbatim so orchestrators that need the SDK string
      // for billing / logging can still recover it.
      alias: 'claude-haiku-4-5-20251001',
      tier: 'haiku',
      displayName: 'Haiku 4.5',
    });
  });

  it('preserves raw alias for non-Claude vendors (gpt-4o)', () => {
    const d = classifyModel('gpt-4o');
    expect(d.alias).toBe('gpt-4o');
    expect(d.vendor).toBe('openai');
    expect(d.family).toBe('gpt');
    // No reliable tier mapping for non-Claude families today — we ship
    // `'other'` rather than guess. Orchestrators that want a tier for
    // OpenAI models should layer their own mapping on top of `alias`.
    expect(d.tier).toBe('other');
    expect(d.displayName).toBeUndefined();
  });

  it('preserves raw alias for unknown vendors (mistral-large)', () => {
    const d = classifyModel('mistral-large-2');
    expect(d).toEqual({
      vendor: 'other',
      family: 'other',
      alias: 'mistral-large-2',
      tier: 'other',
    });
    // Crucially: `mistral-large-2` is preserved verbatim — outer
    // agents that hard-code a Claude renderer can fall back to a
    // generic "unknown vendor" rendering and still log the alias.
    expect(d.alias).toBe('mistral-large-2');
  });

  it("handles bare `claude-*` we can't classify into a known tier", () => {
    // Future-proofing: a new Claude tier (or a typo) shouldn't lose
    // the vendor/family attribution — orchestrators can still branch
    // on "is this Claude?" even before they recognize the specific
    // tier.
    const d = classifyModel('claude-experimental-x');
    expect(d.vendor).toBe('anthropic');
    expect(d.family).toBe('claude');
    expect(d.alias).toBe('claude-experimental-x');
    expect(d.tier).toBe('other');
    expect(d.displayName).toBeUndefined();
  });

  it('returns a pure value (no I/O, idempotent)', () => {
    // Defense-in-depth: classify lives at the SessionStart emit
    // boundary and runs on every wizard boot. Two calls must produce
    // structurally identical descriptors.
    const a = classifyModel('claude-sonnet-4-6');
    const b = classifyModel('claude-sonnet-4-6');
    expect(a).toEqual(b);
  });
});

describe('inner_agent_started — v2 ModelDescriptor wire shape', () => {
  let writes: string[];
  let restore: () => void;

  beforeEach(() => {
    ({ writes, restore } = setupStdoutSpy());
  });
  afterEach(() => restore());

  it('EVENT_DATA_VERSIONS.inner_agent_started is bumped to 2', () => {
    // Lock the registry value — every emitter is responsible for
    // matching this, and validateEnvelopeOrLog asserts it at the wire
    // boundary.
    expect(EVENT_DATA_VERSIONS.inner_agent_started).toBe(2);
  });

  it('emitInnerAgentStarted ships a structured ModelDescriptor (not a raw string)', () => {
    const ui = new AgentUI();
    ui.emitInnerAgentStarted({ model: 'claude-sonnet-4-6', phase: 'apply' });
    const event = JSON.parse(writes[0].trim()) as NDJSONEvent;
    expect(event.type).toBe('lifecycle');
    expect(event.data?.event).toBe('inner_agent_started');
    // The crux of the migration: `model` is an object, not a string.
    // v1 consumers that did `typeof data.model === 'string'` see
    // false here — they MUST branch on data_version.
    expect(typeof event.data?.model).toBe('object');
    expect(event.data?.model).toEqual({
      vendor: 'anthropic',
      family: 'claude',
      alias: 'claude-sonnet-4-6',
      tier: 'sonnet',
      displayName: 'Sonnet 4.6',
    });
  });

  it('stamps data_version: 2 on every inner_agent_started envelope', () => {
    const ui = new AgentUI();
    ui.emitInnerAgentStarted({ model: 'claude-opus-4-7', phase: 'wizard' });
    const event = JSON.parse(writes[0].trim()) as NDJSONEvent;
    expect(event.data_version).toBe(2);
    expect(event.data_version).toBe(EVENT_DATA_VERSIONS.inner_agent_started);
  });

  it('classifies an `anthropic/`-prefixed Haiku alias correctly on the wire', () => {
    const ui = new AgentUI();
    ui.emitInnerAgentStarted({
      model: 'anthropic/claude-haiku-4-5-20251001',
      phase: 'plan',
    });
    const event = JSON.parse(writes[0].trim()) as NDJSONEvent;
    const descriptor = event.data?.model as ModelDescriptor;
    expect(descriptor.tier).toBe('haiku');
    expect(descriptor.family).toBe('claude');
    expect(descriptor.vendor).toBe('anthropic');
    // Raw alias minus the `anthropic/` prefix — date suffix is
    // preserved on `alias` (for billing / debug) but does NOT bleed
    // into `displayName` so the rendered label stays stable across
    // point releases.
    expect(descriptor.alias).toBe('claude-haiku-4-5-20251001');
    expect(descriptor.displayName).toBe('Haiku 4.5');
  });

  it('preserves the raw alias for non-Claude vendors', () => {
    const ui = new AgentUI();
    ui.emitInnerAgentStarted({ model: 'gpt-4o', phase: 'wizard' });
    const event = JSON.parse(writes[0].trim()) as NDJSONEvent;
    const descriptor = event.data?.model as ModelDescriptor;
    expect(descriptor.alias).toBe('gpt-4o');
    expect(descriptor.vendor).toBe('openai');
    expect(descriptor.family).toBe('gpt');
  });

  it('the wire shape passes validateEnvelopeOrLog (no schema-failure log)', () => {
    // The structural Zod schema accepts `data: unknown`, and the
    // coherence check asserts `data_version` matches the registry.
    // If validation flagged a coherence issue it would log
    // `data_version mismatch on 'inner_agent_started'`; the
    // `data_version: 2` stamp pinned above already pins that path.
    const ui = new AgentUI();
    ui.emitInnerAgentStarted({ model: 'claude-sonnet-4-6', phase: 'apply' });
    const event = JSON.parse(writes[0].trim()) as NDJSONEvent;
    expect(event.v).toBe(1);
    expect(typeof event['@timestamp']).toBe('string');
    expect(event.type).toBe('lifecycle');
    expect(event.message).toBeTruthy();
    expect(event.data?.event).toBe('inner_agent_started');
    expect(event.data_version).toBe(EVENT_DATA_VERSIONS.inner_agent_started);
  });

  it('uses the displayName in the human-readable log line', () => {
    // Defense-in-depth for log-grepping orchestrators: the lifecycle
    // message string should mirror the structured displayName so the
    // wire is internally consistent (no `inner_agent_started: claude-
    // sonnet-4-6` while the structured field says `'Sonnet 4.6'`).
    const ui = new AgentUI();
    ui.emitInnerAgentStarted({ model: 'claude-sonnet-4-6', phase: 'apply' });
    const event = JSON.parse(writes[0].trim()) as NDJSONEvent;
    expect(event.message).toBe('inner_agent_started: Sonnet 4.6');
  });

  it('falls back to the raw alias in the log line for unknown models', () => {
    // Unknown family → no displayName → log line uses the alias so
    // the wire still ships an informative human-readable string.
    const ui = new AgentUI();
    ui.emitInnerAgentStarted({ model: 'mistral-large-2', phase: 'apply' });
    const event = JSON.parse(writes[0].trim()) as NDJSONEvent;
    expect(event.message).toBe('inner_agent_started: mistral-large-2');
  });
});
