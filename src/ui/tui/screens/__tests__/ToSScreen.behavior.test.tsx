/**
 * ToSScreen — behavior coverage for the accept/decline dispatch.
 *
 * The snapshot test in `ToSScreen.snap.test.tsx` pins the rendered
 * layout. That alone misses a critical regression: silently swapping
 * the accept/decline branches (so pressing "I accept" actually cancels
 * the wizard) is a legal-correctness bug that text-only assertions
 * can't see. This file pins the dispatch wiring directly.
 *
 * We mock PickerMenu so the screen's `onSelect` prop is captured and we
 * can drive each branch deterministically without simulating keyboard
 * input. The mock is scoped to this file — the snapshot test sees the
 * real picker.
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ToSScreen } from '../ToSScreen.js';
import { makeStoreForSnapshot } from '../../__tests__/snapshot-utils.js';

let capturedOnSelect: ((v: string | string[]) => void) | null = null;
vi.mock('../../primitives/index.js', async (importActual) => {
  const actual = await importActual<
    typeof import('../../primitives/index.js')
  >();
  return {
    ...actual,
    PickerMenu: <T,>(props: { onSelect: (v: T | T[]) => void }) => {
      capturedOnSelect = props.onSelect as (v: string | string[]) => void;
      return null;
    },
  };
});

function renderWithSpies(): {
  accept: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  invoke: (value: string | string[]) => void;
  unmount: () => void;
} {
  capturedOnSelect = null;
  const store = makeStoreForSnapshot();
  const accept = vi.fn();
  const cancel = vi.fn();
  store.acceptTermsOfService = accept;
  store.cancelWizard = cancel;
  const { unmount } = render(<ToSScreen store={store} />);
  if (!capturedOnSelect) {
    throw new Error(
      'ToSScreen did not pass an onSelect to PickerMenu — wiring regressed.',
    );
  }
  return {
    accept,
    cancel,
    invoke: (value) => capturedOnSelect!(value),
    unmount,
  };
}

describe('ToSScreen behavior', () => {
  it('"accept" dispatches acceptTermsOfService and never cancels', () => {
    const { accept, cancel, invoke, unmount } = renderWithSpies();
    invoke('accept');
    unmount();
    expect(accept).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('"decline" dispatches cancelWizard with a reason and never accepts', () => {
    const { accept, cancel, invoke, unmount } = renderWithSpies();
    invoke('decline');
    unmount();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel.mock.calls[0][0]).toMatch(/not accepted/i);
    expect(accept).not.toHaveBeenCalled();
  });

  it('forwards string-array picker values (defensive — multiselect path)', () => {
    // PickerMenu can hand back `string[]` in a multiselect config. Today
    // the screen uses single-select so this path is theoretical, but the
    // `Array.isArray(value)` branch is in production code; if it
    // regresses, the screen would silently no-op. Pin the contract.
    const { accept, invoke, unmount } = renderWithSpies();
    invoke(['accept']);
    unmount();
    expect(accept).toHaveBeenCalledTimes(1);
  });
});
