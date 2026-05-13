/**
 * decision_id correlation between `needs_input` requests and
 * `decision_auto` resolutions.
 *
 * Pins the wire-shape contract that PR B3 introduces:
 *
 *   - Every `needs_input` envelope carries `data.decisionId: dec_<NNN>`.
 *   - The matching `decision_auto` envelope echoes the SAME `decisionId`.
 *   - Ids are monotonic across a single wizard run, so two prompts that
 *     reuse a `code` (back-to-back `confirm`, paginated env pickers) are
 *     still uniquely pairable by their id.
 *   - Both event types stamp `data_version: 2` (bumped from 1 to add
 *     `decisionId` — orchestrators branch on `data_version >= 2` if they
 *     want strict correlation).
 *
 * Why pin this: the previous wire shape forced orchestrators to
 * reconstruct request/response pairing by timing + `code` heuristics,
 * which silently broke the moment two prompts shared a code. The
 * regression target here is "we never ship a `decision_auto` without
 * its matching `needs_input.decisionId`."
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentUI } from '../agent-ui.js';
import {
  __resetDecisionIdCounterForTests,
  EVENT_DATA_VERSIONS,
  nextDecisionId,
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

describe('decision_id generator', () => {
  beforeEach(() => {
    __resetDecisionIdCounterForTests();
  });

  it('returns dec_001, dec_002, … zero-padded', () => {
    expect(nextDecisionId()).toBe('dec_001');
    expect(nextDecisionId()).toBe('dec_002');
    expect(nextDecisionId()).toBe('dec_003');
  });

  it('survives across hundreds of calls without breaking padding', () => {
    for (let i = 1; i <= 9; i++) nextDecisionId();
    expect(nextDecisionId()).toBe('dec_010');
    for (let i = 11; i <= 99; i++) nextDecisionId();
    expect(nextDecisionId()).toBe('dec_100');
  });
});

describe('decision_id correlation — needs_input ↔ decision_auto', () => {
  let writes: string[];
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetDecisionIdCounterForTests();
    writes = [];
    spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      });
  });

  afterEach(() => {
    spy.mockRestore();
  });

  const parseAll = (): NDJSONEvent[] =>
    writes.map((l) => JSON.parse(l.trim()) as NDJSONEvent);

  it('promptConfirm: needs_input.decisionId matches decision_auto.decisionId', () => {
    const ui = new AgentUI();
    void ui.promptConfirm('Apply this plan?');

    // Order: legacy prompt → needs_input → decision_auto.
    const events = parseAll();
    expect(events.length).toBe(3);
    const needsInput = events[1];
    const decisionAuto = events[2];

    expect(needsInput.type).toBe('needs_input');
    expect(needsInput.data?.event).toBe('needs_input');
    expect(typeof needsInput.data?.decisionId).toBe('string');
    expect(needsInput.data?.decisionId).toMatch(/^dec_\d{3}$/);

    expect(decisionAuto.data?.event).toBe('decision_auto');
    expect(decisionAuto.data?.decisionId).toBe(needsInput.data?.decisionId);
  });

  it('promptChoice: needs_input.decisionId matches decision_auto.decisionId', () => {
    const ui = new AgentUI();
    void ui.promptChoice('Pick a framework', ['nextjs', 'vue', 'svelte']);

    const events = parseAll();
    expect(events.length).toBe(3);
    const needsInput = events[1];
    const decisionAuto = events[2];

    expect(needsInput.data?.event).toBe('needs_input');
    expect(decisionAuto.data?.event).toBe('decision_auto');
    expect(needsInput.data?.decisionId).toMatch(/^dec_\d{3}$/);
    expect(decisionAuto.data?.decisionId).toBe(needsInput.data?.decisionId);
  });

  it('two back-to-back confirm prompts mint distinct decisionIds', () => {
    // The core motivation: orchestrators previously had to disambiguate
    // two same-`code` prompts by timing, which fails under any reorder
    // or interleaving. Locking in here that each request has its own id.
    const ui = new AgentUI();
    void ui.promptConfirm('First confirm?');
    void ui.promptConfirm('Second confirm?');

    const events = parseAll();
    const needsInputs = events.filter((e) => e.data?.event === 'needs_input');
    const decisionAutos = events.filter(
      (e) => e.data?.event === 'decision_auto',
    );
    expect(needsInputs).toHaveLength(2);
    expect(decisionAutos).toHaveLength(2);

    const firstId = needsInputs[0].data?.decisionId as string;
    const secondId = needsInputs[1].data?.decisionId as string;
    expect(firstId).not.toBe(secondId);
    expect(decisionAutos[0].data?.decisionId).toBe(firstId);
    expect(decisionAutos[1].data?.decisionId).toBe(secondId);
  });

  it('emitNeedsInput returns the freshly-minted decisionId', () => {
    const ui = new AgentUI();
    const id = ui.emitNeedsInput({
      code: 'project_selection',
      message: 'Pick a project',
      choices: [{ value: '1', label: 'P1' }],
      recommended: '1',
    });
    expect(id).toMatch(/^dec_\d{3}$/);

    const event = JSON.parse(writes[0].trim()) as NDJSONEvent;
    expect(event.data?.decisionId).toBe(id);
  });

  it('emitNeedsInput honors an explicit decisionId when supplied', () => {
    // Lets the env-picker (or any future paged emitter) keep a stable id
    // across pages. The wire shape stays orchestrator-compatible because
    // explicit ids still match the dec_NNN pattern when sourced from
    // nextDecisionId() — and the type only documents callers SHOULD use
    // the returned id.
    const ui = new AgentUI();
    const id = ui.emitNeedsInput({
      code: 'project_selection',
      decisionId: 'dec_999',
      message: 'Pick a project',
      choices: [{ value: '1', label: 'P1' }],
    });
    expect(id).toBe('dec_999');

    const event = JSON.parse(writes[0].trim()) as NDJSONEvent;
    expect(event.data?.decisionId).toBe('dec_999');
  });
});

describe('data_version bump for decisionId fields', () => {
  let writes: string[];
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetDecisionIdCounterForTests();
    writes = [];
    spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      });
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it('registers needs_input and decision_auto at v=2 in EVENT_DATA_VERSIONS', () => {
    expect(EVENT_DATA_VERSIONS.needs_input).toBe(2);
    expect(EVENT_DATA_VERSIONS.decision_auto).toBe(2);
  });

  it('stamps data_version=2 on the needs_input envelope', () => {
    const ui = new AgentUI();
    void ui.promptConfirm('Stamp?');
    const events = writes.map((l) => JSON.parse(l.trim()) as NDJSONEvent);
    const needsInput = events.find((e) => e.data?.event === 'needs_input');
    expect(needsInput?.data_version).toBe(2);
  });

  it('stamps data_version=2 on the decision_auto envelope', () => {
    const ui = new AgentUI();
    void ui.promptConfirm('Stamp?');
    const events = writes.map((l) => JSON.parse(l.trim()) as NDJSONEvent);
    const decisionAuto = events.find((e) => e.data?.event === 'decision_auto');
    expect(decisionAuto?.data_version).toBe(2);
  });
});
