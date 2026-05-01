/**
 * Tests for `buildHooksConfig` — specifically the per-hook timeout
 * application. Each row in `HOOK_TIMEOUTS` is a real reliability
 * upper bound; this file pins the contract so refactors don't
 * silently drop a cap or, worse, add one to PreToolUse (which would
 * be a safety regression — see HOOK_TIMEOUTS comment in agent-hooks).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildHooksConfig,
  type HookCallback,
  type HookEvent,
} from '../agent-hooks';

/** Convenience: a no-op hook callback. */
const noop: HookCallback = () => Promise.resolve({});

/** Returns the timeout (in seconds) the SDK would see for a given hook. */
function timeoutFor(
  config: ReturnType<typeof buildHooksConfig>,
  hook: HookEvent,
): number | undefined {
  const entry = config[hook];
  if (!entry || entry.length === 0) return undefined;
  return entry[0]?.timeout;
}

describe('buildHooksConfig — per-hook timeouts', () => {
  // The five hooks the wizard wires today (see `agent-interface.ts:3050`).
  // Update both this list AND the timeout table when adding a new hook.
  const allHooks: Partial<Record<HookEvent, HookCallback>> = {
    SessionStart: noop,
    PreToolUse: noop,
    PostToolUse: noop,
    Stop: noop,
    PreCompact: noop,
    UserPromptSubmit: noop,
  };

  it.each([
    ['Stop', 8],
    ['PostToolUse', 5],
    ['SessionStart', 5],
    ['UserPromptSubmit', 5],
    ['PreCompact', 5],
  ] as const)('caps %s at %ss', (hook, expectedSeconds) => {
    const config = buildHooksConfig(allHooks);
    expect(timeoutFor(config, hook)).toBe(expectedSeconds);
  });

  it('does NOT cap PreToolUse — it is a safety gate, fail-closed', () => {
    // Critical invariant: a PreToolUse timeout would let the SDK
    // proceed without the wizard's bash safety verdict. Prefer the
    // outer 60s stall timer to surface a hung scanner. See the
    // HOOK_TIMEOUTS comment in `agent-hooks.ts` for the full
    // rationale.
    const config = buildHooksConfig(allHooks);
    expect(timeoutFor(config, 'PreToolUse')).toBeUndefined();
  });

  it('omits hooks that have no callback', () => {
    // Only PostToolUse is wired; everything else should be absent
    // from the output entirely (no empty matchers, no stub timeouts).
    const config = buildHooksConfig({ PostToolUse: noop });
    expect(Object.keys(config)).toEqual(['PostToolUse']);
  });

  it('passes through the callback intact', () => {
    const cb = vi.fn(noop);
    const config = buildHooksConfig({ PostToolUse: cb });
    expect(config.PostToolUse?.[0]?.hooks).toEqual([cb]);
  });
});
