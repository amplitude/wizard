/**
 * useAtomSelector — verifies narrow-subscription semantics.
 *
 * The hook always re-renders when the store emits (the store's
 * subscribe model is version-based, not slice-keyed) but its selected
 * snapshot MUST keep referential identity when the slice value is
 * unchanged. Tests cover:
 *   1. Identity of the snapshot when the slice equals the previous
 *      value under `isEqual`.
 *   2. Re-render with a fresh value when the slice changes.
 *   3. `shallowArrayEqual` helper.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { WizardStore } from '../../store.js';
import {
  useAtomSelector,
  shallowArrayEqual,
} from '../useAtomSelector.js';

describe('shallowArrayEqual', () => {
  it('treats two empty arrays as equal', () => {
    expect(shallowArrayEqual([], [])).toBe(true);
  });

  it('treats same-content arrays of primitives as equal', () => {
    expect(shallowArrayEqual([1, 2, 3], [1, 2, 3])).toBe(true);
  });

  it('returns false when lengths differ', () => {
    expect(shallowArrayEqual([1], [1, 2])).toBe(false);
  });

  it('returns false when any element differs', () => {
    expect(shallowArrayEqual([1, 2, 3], [1, 4, 3])).toBe(false);
  });

  it('uses Object.is for element equality (objects)', () => {
    const ref = { a: 1 };
    expect(shallowArrayEqual([ref], [ref])).toBe(true);
    expect(shallowArrayEqual([{ a: 1 }], [{ a: 1 }])).toBe(false);
  });
});

describe('useAtomSelector', () => {
  it('returns the selected slice from the store', () => {
    const store = new WizardStore();
    store.pushStatus('hello');

    let captured: string | null = null;
    const selector = (s: WizardStore) =>
      s.statusMessages[s.statusMessages.length - 1] ?? null;

    function Harness() {
      const status = useAtomSelector(store, selector);
      captured = status;
      return <Text>status={status ?? '∅'}</Text>;
    }

    const { lastFrame, unmount } = render(<Harness />);
    expect(lastFrame()).toContain('status=hello');
    expect(captured).toBe('hello');
    unmount();
  });

  it('preserves snapshot identity when the slice value is unchanged', () => {
    const store = new WizardStore();
    store.setTasks([
      { label: 'a', status: 'pending' as never, done: false },
      { label: 'b', status: 'pending' as never, done: false },
    ]);

    const captures: Array<readonly unknown[]> = [];
    const selector = (s: WizardStore) => s.tasks.slice(0, 2);

    function Harness() {
      const slice = useAtomSelector(store, selector, shallowArrayEqual);
      captures.push(slice);
      return <Text>{slice.length}</Text>;
    }

    const { rerender, unmount } = render(<Harness />);

    // Fire an unrelated store change that does NOT touch tasks.
    store.pushStatus('unrelated');
    rerender(<Harness />);

    // Even after a re-render driven by the store tick, the selector
    // produced a shallow-equal array → snapshot identity preserved.
    expect(captures.length).toBeGreaterThan(1);
    expect(captures[captures.length - 1]).toBe(captures[0]);

    unmount();
  });

  it('returns a fresh snapshot when the slice value changes', () => {
    const store = new WizardStore();
    store.pushStatus('first');

    const captures: Array<string | null> = [];
    const selector = (s: WizardStore) =>
      s.statusMessages[s.statusMessages.length - 1] ?? null;

    function Harness() {
      const status = useAtomSelector(store, selector);
      captures.push(status);
      return <Text>{status ?? '∅'}</Text>;
    }

    const { rerender, lastFrame, unmount } = render(<Harness />);
    expect(lastFrame()).toContain('first');

    store.pushStatus('second');
    rerender(<Harness />);

    expect(lastFrame()).toContain('second');
    expect(captures[captures.length - 1]).toBe('second');
    expect(captures[0]).toBe('first');

    unmount();
  });
});
