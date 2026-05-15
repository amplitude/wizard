/**
 * Regression: `waiting_for_user` is a type alias for `needs_input`.
 *
 * Orchestrators reading the protocol docs see two names for the same
 * concept. PR B4 wires `WaitingForUserData` / `WaitingForUserWireData` /
 * `WaitingForUserEvent` as type-identical re-exports of the
 * `NeedsInput*` family so consumer code can import whichever spelling
 * matches its mental model. This test pins the equivalence so a future
 * accidental divergence (adding a field to one but not the other) is
 * caught at type-check time AND at run time via a value-level proof.
 *
 * The test deliberately does NOT exercise any wire emission — the
 * deferred-by-design property is that no `waiting_for_user` envelope
 * appears on stdout. We assert that contract by NOT registering an
 * `EVENT_DATA_VERSIONS.waiting_for_user` entry.
 */
import { describe, it, expect } from 'vitest';
import {
  EVENT_DATA_VERSIONS,
  type NeedsInputData,
  type NeedsInputWireData,
  type NeedsInputEvent,
  type WaitingForUserData,
  type WaitingForUserWireData,
  type WaitingForUserEvent,
} from '../agent-events.js';

describe('waiting_for_user alias', () => {
  it('is structurally assignable from NeedsInputData (forward direction)', () => {
    const needs: NeedsInputData = {
      code: 'environment_selection',
      message: 'Pick an environment',
      choices: [{ value: 'prod', label: 'Production' }],
    };
    // If the alias diverges from NeedsInputData this assignment fails
    // at compile time — the runtime check is just a smoke for the
    // assignment having actually happened.
    const waiting: WaitingForUserData = needs;
    expect(waiting.code).toBe('environment_selection');
  });

  it('is structurally assignable to NeedsInputData (reverse direction)', () => {
    const waiting: WaitingForUserData = {
      code: 'event_plan_approval',
      message: 'Approve the event plan?',
      choices: [
        { value: 'approve', label: 'Approve' },
        { value: 'revise', label: 'Revise' },
      ],
      recommended: 'approve',
    };
    const needs: NeedsInputData = waiting;
    expect(needs.recommended).toBe('approve');
  });

  it('wire-data alias carries the canonical needs_input discriminator', () => {
    // Critical contract: the alias must NOT change `event` on the
    // wire. Orchestrators subscribe to `event === 'needs_input'`; if
    // we ever shipped `'waiting_for_user'` we'd silently break every
    // existing consumer.
    const wire: WaitingForUserWireData = {
      event: 'needs_input',
      code: 'confirm',
      decisionId: 'dec_001',
      choices: [],
    };
    const asNeeds: NeedsInputWireData = wire;
    expect(asNeeds.event).toBe('needs_input');
  });

  it('envelope alias is the same shape as NeedsInputEvent', () => {
    const envelope: WaitingForUserEvent = {
      v: 1,
      '@timestamp': '2026-05-11T00:00:00.000Z',
      type: 'needs_input',
      message: 'Pick a region',
      data: {
        event: 'needs_input',
        code: 'region_selection',
        decisionId: 'dec_002',
        choices: [
          { value: 'us', label: 'US' },
          { value: 'eu', label: 'EU' },
        ],
      },
    };
    const asNeeds: NeedsInputEvent = envelope;
    expect(asNeeds.type).toBe('needs_input');
    expect(asNeeds.data?.event).toBe('needs_input');
  });

  it('does NOT register a waiting_for_user entry in EVENT_DATA_VERSIONS', () => {
    // There is no separate wire event. Orchestrators key off the
    // existing `needs_input` data_version. A future contributor who
    // adds an EVENT_DATA_VERSIONS.waiting_for_user entry must also
    // wire a separate emitter, schema, and tests — the absence of
    // this entry is the load-bearing signal that this is alias-only.
    expect(
      (EVENT_DATA_VERSIONS as Readonly<Record<string, number>>)
        .waiting_for_user,
    ).toBeUndefined();
    expect(EVENT_DATA_VERSIONS.needs_input).toBeGreaterThanOrEqual(1);
  });
});
