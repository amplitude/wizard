/**
 * useWizardSelector — slice subscription tests.
 *
 * Validates the v2 PR 5 render-cost teardown: a slice subscriber must
 * NOT rerender when the slice it cares about is unchanged, even though
 * the underlying store version bumped.
 *
 * Note: ink-testing-library does not run effects on a fully reentrant
 * React tree, so we exercise the underlying primitive directly via a
 * "harness" callback fed into the same equality logic the hook uses.
 * The hook itself is a thin `useSyncExternalStore` wrapper — the
 * interesting behavior lives in the equality + selector ref pattern,
 * which we test in isolation.
 */
import { describe, it, expect } from 'vitest';
import { WizardStore } from '../../store.js';
import {
  shallowArrayEqual,
  shallowObjectEqual,
} from '../useWizardSelector.js';

describe('useWizardSelector primitives', () => {
  it('shallowArrayEqual avoids rerenders for same-content arrays', () => {
    expect(shallowArrayEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(shallowArrayEqual([1, 2, 3], [1, 2, 4])).toBe(false);
    expect(shallowArrayEqual([1, 2, 3], [1, 2])).toBe(false);
    expect(shallowArrayEqual([], [])).toBe(true);
  });

  it('shallowObjectEqual treats same-keys-same-values as equal', () => {
    expect(shallowObjectEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(shallowObjectEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
    expect(shallowObjectEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(shallowObjectEqual({}, {})).toBe(true);
  });

  it('shallowObjectEqual rejects disjoint key sets even when key counts match', () => {
    // Regression: previously the loop only iterated keys of `a` and
    // compared values via property access, so `b.x` resolving to
    // `undefined` would falsely match `a.x === undefined` even when
    // `b` did not actually have key `x`. With a `hasOwnProperty` check
    // on `b`, disjoint key sets correctly compare unequal.
    expect(
      shallowObjectEqual({ x: undefined, y: 1 }, { z: undefined, y: 1 }),
    ).toBe(false);
    expect(shallowObjectEqual({ a: undefined }, { b: undefined })).toBe(false);
  });

  it('store subscribe fires once per emitChange', () => {
    const store = new WizardStore();
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.pushStatus('a');
    store.pushStatus('b');
    store.pushStatus('c');
    unsubscribe();
    // At least one fire per pushStatus (some setters emit twice — store
    // implementation detail). The contract: at minimum N fires for N
    // emitting mutations.
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('selector pattern simulates the slice equality bail-out', () => {
    // Simulate the inner getSnapshot of useWizardSelector by hand. This
    // is the same code path the hook uses; we exercise it without a
    // React renderer because ink-testing-library does not flush
    // useSyncExternalStore reactions synchronously enough for a render
    // count assertion.
    const store = new WizardStore();
    const selector = (s: WizardStore) => s.session.region ?? 'none';
    let lastValue = selector(store);
    let materialized = 1; // initial subscribe pulls one value
    const onChange = () => {
      const next = selector(store);
      if (!Object.is(lastValue, next)) {
        materialized += 1;
        lastValue = next;
      }
    };
    const unsubscribe = store.subscribe(onChange);

    store.pushStatus('a'); // unrelated slice
    store.pushStatus('b'); // unrelated slice
    store.pushStatus('c'); // unrelated slice
    expect(materialized).toBe(1);

    store.session = { ...store.session, region: 'eu' };
    expect(materialized).toBe(2);
    expect(lastValue).toBe('eu');

    store.pushStatus('d'); // unrelated slice again
    expect(materialized).toBe(2);

    unsubscribe();
  });
});
