/**
 * agentInterrupt — unit coverage for the synthetic-pause stub (PR 6).
 *
 * Pins the contract the AskBar + RunScreen wiring relies on:
 *
 *   - `interrupt()` flips `paused` to true (idempotent).
 *   - `resume()` flips `paused` to false (idempotent) and leaves the
 *     pending queue alone — drain is the agent runner's job.
 *   - `inject(msg)` queues trimmed messages in insertion order.
 *   - `drainPendingInjections()` returns the queue and empties it.
 *   - Subscribers see exactly one notification per visible transition.
 *
 * The actual Claude Agent SDK wiring is deferred; these tests pin the
 * shape the follow-up PR will hook into.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import * as agentInterrupt from '../agentInterrupt.js';

beforeEach(() => {
  agentInterrupt.__resetForTests();
});

describe('agentInterrupt — interrupt / resume', () => {
  it('starts paused=false with an empty queue', () => {
    const state = agentInterrupt.getState();
    expect(state.paused).toBe(false);
    expect(state.pending).toEqual([]);
  });

  it('interrupt() flips paused to true', () => {
    agentInterrupt.interrupt();
    expect(agentInterrupt.getState().paused).toBe(true);
  });

  it('interrupt() is idempotent when already paused', () => {
    agentInterrupt.interrupt();
    agentInterrupt.interrupt();
    expect(agentInterrupt.getState().paused).toBe(true);
  });

  it('resume() flips paused back to false', () => {
    agentInterrupt.interrupt();
    agentInterrupt.resume();
    expect(agentInterrupt.getState().paused).toBe(false);
  });

  it('resume() is idempotent when not paused', () => {
    agentInterrupt.resume();
    expect(agentInterrupt.getState().paused).toBe(false);
  });

  it('resume() leaves the pending queue intact for the agent runner to drain', () => {
    agentInterrupt.interrupt();
    agentInterrupt.inject('why so slow?');
    agentInterrupt.resume();
    expect(agentInterrupt.getState().pending).toEqual(['why so slow?']);
  });
});

describe('agentInterrupt — inject', () => {
  it('queues a single message', () => {
    const queued = agentInterrupt.inject('what files?');
    expect(queued).toBe('what files?');
    expect(agentInterrupt.getState().pending).toEqual(['what files?']);
  });

  it('trims whitespace', () => {
    agentInterrupt.inject('   why?   ');
    expect(agentInterrupt.getState().pending).toEqual(['why?']);
  });

  it('returns null and queues nothing for empty input', () => {
    const queued = agentInterrupt.inject('     ');
    expect(queued).toBeNull();
    expect(agentInterrupt.getState().pending).toEqual([]);
  });

  it('preserves insertion order across multiple concurrent calls', () => {
    // Synchronous "concurrent" — the JS event loop will interleave any
    // async sources but the module-state singleton guarantees order.
    // The eventual SDK wiring will rely on this contract when stitching
    // user questions into the agent's next turn.
    agentInterrupt.inject('first');
    agentInterrupt.inject('second');
    agentInterrupt.inject('third');
    expect(agentInterrupt.getState().pending).toEqual([
      'first',
      'second',
      'third',
    ]);
  });
});

describe('agentInterrupt — drainPendingInjections', () => {
  it('returns and clears the pending queue', () => {
    agentInterrupt.inject('a');
    agentInterrupt.inject('b');
    const drained = agentInterrupt.drainPendingInjections();
    expect(drained).toEqual(['a', 'b']);
    expect(agentInterrupt.getState().pending).toEqual([]);
  });

  it('is a no-op when the queue is empty', () => {
    const drained = agentInterrupt.drainPendingInjections();
    expect(drained).toEqual([]);
    expect(agentInterrupt.getState().pending).toEqual([]);
  });
});

describe('agentInterrupt — subscribe', () => {
  it('fires synchronously on interrupt', () => {
    let notifications = 0;
    agentInterrupt.subscribe(() => {
      notifications++;
    });
    agentInterrupt.interrupt();
    expect(notifications).toBe(1);
  });

  it('does not fire on a no-op transition', () => {
    let notifications = 0;
    agentInterrupt.subscribe(() => {
      notifications++;
    });
    agentInterrupt.interrupt();
    agentInterrupt.interrupt(); // already paused — must not re-notify
    expect(notifications).toBe(1);
  });

  it('passes the latest state to the callback', () => {
    const seen: boolean[] = [];
    agentInterrupt.subscribe((state) => {
      seen.push(state.paused);
    });
    agentInterrupt.interrupt();
    agentInterrupt.resume();
    expect(seen).toEqual([true, false]);
  });

  it('respects unsubscribe', () => {
    let notifications = 0;
    const unsub = agentInterrupt.subscribe(() => {
      notifications++;
    });
    agentInterrupt.interrupt();
    unsub();
    agentInterrupt.resume();
    expect(notifications).toBe(1);
  });

  it('isolates a listener that throws', () => {
    let calls = 0;
    agentInterrupt.subscribe(() => {
      throw new Error('boom');
    });
    agentInterrupt.subscribe(() => {
      calls++;
    });
    // Must not propagate the throw — wizard rendering depends on this.
    expect(() => agentInterrupt.interrupt()).not.toThrow();
    expect(calls).toBe(1);
  });
});

describe('agentInterrupt — getState immutability', () => {
  it('returns a frozen snapshot the caller cannot mutate', () => {
    agentInterrupt.inject('hi');
    const snapshot = agentInterrupt.getState();
    expect(Object.isFrozen(snapshot)).toBe(true);
    // Mutating the snapshot must not leak back into module state.
    expect(() => {
      // @ts-expect-error — intentional violation of the readonly shape.
      snapshot.paused = true;
    }).toThrow();
    expect(agentInterrupt.getState().paused).toBe(false);
  });
});
