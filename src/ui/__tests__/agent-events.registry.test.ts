/**
 * EVENT_DATA_VERSIONS registry invariant — runtime-observed coverage.
 *
 * Catches the class of bug Bugbot caught for `project_created` (mismatch
 * between the emitted `data.event` string and the registry key) and the
 * 5+ regressions a multi-perspective audit found later (`outro_data`,
 * `signup_input_required`, `post_agent_seeded`, `post_agent_step`,
 * `journey_transition`, `current_activity` — all emitted, none registered).
 *
 * Invariants:
 *
 *  (A) Every `data.event` discriminator AgentUI actually puts on the wire
 *      MUST have a corresponding entry in `EVENT_DATA_VERSIONS`. Without
 *      this, the `data_version` stamp is silently dropped, the coherence
 *      check in `validateEnvelopeOrLog` skips the event, and
 *      `wizard_capabilities.supportedEvents` lies about what the wizard
 *      speaks.
 *
 *  (B) Every registry entry MUST have at least one emit callsite. A
 *      registered-but-unemitted entry means `supportedEvents` advertises
 *      an event no orchestrator will ever see — dead protocol surface.
 *
 * Strategy: invoke each public AgentUI emitter that's part of the
 * orchestrator-facing contract, capture every NDJSON line written to
 * stdout, extract `data.event` discriminators, and compare against
 * `Object.keys(EVENT_DATA_VERSIONS)`.
 *
 * The list of emitters exercised here is intentionally broad — adding a
 * new orchestrator-facing event without exercising it here is fine for
 * invariant (B) (it's covered by the grep fallback below) but will be
 * caught by invariant (A) the moment the new event actually fires in
 * any other test or production run.
 *
 * Invariant (B) is also enforced statically via a grep over
 * `src/ui/agent-ui.ts` so an event emitted in a code path the test
 * doesn't exercise still counts. The grep is the source of truth for
 * "every event the wizard speaks"; the runtime walk is the source of
 * truth for "every event the wizard speaks AND the registry agrees on
 * the discriminator name spelling."
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { AgentUI } from '../agent-ui.js';
import { EVENT_DATA_VERSIONS } from '../../lib/agent-events.js';

interface NDJSONEvent {
  v: 1;
  '@timestamp': string;
  type: string;
  message: string;
  data?: Record<string, unknown>;
  data_version?: number;
}

const REGISTRY_KEYS = new Set(Object.keys(EVENT_DATA_VERSIONS));

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT_UI_SOURCE_PATH = resolve(HERE, '../agent-ui.ts');
const AGENT_EVENTS_SOURCE_PATH = resolve(HERE, '../../lib/agent-events.ts');

/**
 * Static grep across the two files where a discriminator can be born:
 *
 *   1. `src/ui/agent-ui.ts` — direct `emit('...', ..., { data: { event:
 *      '<name>' ... } })` callsites.
 *   2. `src/lib/agent-events.ts` — typed builder functions
 *      (`buildProgressEstimate`, `buildColdStartBreakdown`,
 *      `buildToolCallSummary`) that return `{ event: '<name>', ... }`
 *      payloads consumed by emitters in `agent-ui.ts`.
 *
 * Together these cover every discriminator that can possibly land on
 * the wire. Regex tolerates single OR double-quoted discriminator
 * strings.
 */
function extractEmittedDiscriminators(): Set<string> {
  const set = new Set<string>();
  const re = /event:\s*(['"])([a-z][a-z0-9_]*)\1/g;
  for (const path of [AGENT_UI_SOURCE_PATH, AGENT_EVENTS_SOURCE_PATH]) {
    const src = readFileSync(path, 'utf8');
    let match: RegExpExecArray | null;
    while ((match = re.exec(src)) !== null) {
      set.add(match[2]);
    }
    // Reset regex state between files (g-flag is stateful per-instance).
    re.lastIndex = 0;
  }
  return set;
}

describe('EVENT_DATA_VERSIONS registry — emit/registry sync invariant', () => {
  // ── Invariant A: runtime-observed discriminators ↘ registry ───────
  //
  // Walk a representative slice of AgentUI emitter methods and assert
  // every captured `data.event` value has a registry entry AND the
  // emitted envelope carries `data_version` stamped from that entry.

  let writes: string[];
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
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

  /**
   * Exercise every emitter that's part of the orchestrator-facing
   * contract. New emitters should be added here so a missing registry
   * entry is caught on PR rather than after a release.
   *
   * Methods that require complex state setup (e.g. terminal `outro` /
   * `setup_complete` paths that touch process.exit) are exercised
   * elsewhere — invariant (B) below covers them via the static grep.
   */
  it('every emitter that lands a discriminator on the wire is registered', () => {
    const ui = new AgentUI();
    // Lifecycle / cold-start
    ui.startRun();
    ui.intro('hi');
    ui.outro('bye');
    ui.setOutroData({ kind: 'success', message: 'done' });
    ui.emitAuthRequired({
      reason: 'no_stored_credentials',
      instruction: 'login',
      loginCommand: ['x'],
    });
    ui.emitSignupInputsRequired({
      missing: [{ flag: '--foo', description: 'foo' }],
      resumeCommand: ['x'],
    });
    ui.emitNestedAgent({
      signal: 'claude_code_cli',
      envVar: 'CLAUDECODE',
      instruction: 'i',
      bypassEnv: 'X',
    });
    ui.emitInnerAgentStarted({ model: 'm', phase: 'wizard' });
    // Project create
    ui.emitProjectCreateStart({ orgId: 'o', name: 'n' });
    ui.emitProjectCreateSuccess({ orgId: 'o', appId: 1, name: 'n', url: 'u' });
    ui.emitProjectCreateError({
      orgId: 'o',
      name: 'n',
      code: 'X',
      message: 'm',
    });
    // Tool / file
    ui.emitToolCall({ tool: 'Edit', summary: 'e' });
    ui.emitFileChangePlanned({ operation: 'create', path: 'p' });
    ui.emitFileChangeApplied({ operation: 'create', path: 'p' });
    // Verification
    ui.emitVerificationStarted({ phase: 'sdk_init' });
    ui.emitVerificationResult({
      phase: 'sdk_init',
      passed: true,
      details: 'd',
    });
    // Event plan
    ui.setEventPlan([{ name: 'Sign Up', description: 'd' }]);
    ui.setEventIngestionDetected(['Sign Up']);
    ui.setDashboardUrl('https://example.com');
    // Post-agent step queue
    ui.seedPostAgentSteps([
      {
        id: 'commit-events',
        label: 'Commit events',
        activeForm: 'Committing events',
        status: 'pending',
      },
    ]);
    ui.setPostAgentStep('commit-events', { status: 'in_progress' });
    // Journey stepper
    ui.applyJourneyTransition('setup', 'in_progress');
    // Current activity
    ui.setCurrentActivity({
      kind: 'cold-start',
      message: 'starting up',
      startedAt: Date.now(),
    });
    ui.setCurrentActivity(null);

    const events = writes.map((l) => JSON.parse(l.trim()) as NDJSONEvent);
    const versioned = events.filter(
      (e) =>
        typeof e.data === 'object' &&
        e.data !== null &&
        typeof (e.data as { event?: unknown }).event === 'string',
    );
    expect(versioned.length).toBeGreaterThan(0);

    const registry = EVENT_DATA_VERSIONS as Readonly<Record<string, number>>;
    const missingFromRegistry: string[] = [];
    const missingDataVersion: Array<{ event: string; got: unknown }> = [];

    for (const e of versioned) {
      const eventName = (e.data as { event: string }).event;
      const expected = registry[eventName];
      if (expected === undefined) {
        missingFromRegistry.push(eventName);
        continue;
      }
      if (e.data_version !== expected) {
        missingDataVersion.push({ event: eventName, got: e.data_version });
      }
    }

    expect(
      missingFromRegistry,
      `Discriminators on the wire with no EVENT_DATA_VERSIONS entry: ` +
        `${[...new Set(missingFromRegistry)].sort().join(', ')}. ` +
        `Add each one to EVENT_DATA_VERSIONS in src/lib/agent-events.ts.`,
    ).toEqual([]);
    expect(
      missingDataVersion,
      `Events without a matching data_version stamp: ` +
        JSON.stringify(missingDataVersion),
    ).toEqual([]);
  });

  // ── Invariant B: static grep ↔ registry (bidirectional) ───────────
  //
  // Source-of-truth comparison. The grep finds every `event: '<name>'`
  // literal in agent-ui.ts; the registry is `EVENT_DATA_VERSIONS`. The
  // two sets must match exactly — no orphaned literals, no orphaned
  // entries.

  it('every emitted discriminator in agent-ui.ts has a registry entry', () => {
    const emitted = extractEmittedDiscriminators();
    const missing = [...emitted].filter((e) => !REGISTRY_KEYS.has(e));
    expect(
      missing.sort(),
      `These discriminators are emitted in agent-ui.ts but missing ` +
        `from EVENT_DATA_VERSIONS. Add each one to the registry in ` +
        `src/lib/agent-events.ts so its data_version stamp lands on ` +
        `the wire and wizard_capabilities.supportedEvents stays honest.`,
    ).toEqual([]);
  });

  it('every registry entry is emitted at least once in agent-ui.ts', () => {
    const emitted = extractEmittedDiscriminators();
    const orphaned = [...REGISTRY_KEYS].filter((k) => !emitted.has(k));
    expect(
      orphaned.sort(),
      `These discriminators are registered in EVENT_DATA_VERSIONS but ` +
        `never emitted anywhere in agent-ui.ts. Either remove the ` +
        `registry entry or add the missing emitter.`,
    ).toEqual([]);
  });
});
