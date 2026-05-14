/**
 * Regression: digit-shortcut UI hints on large PickerMenu lists.
 *
 * The picker exposes `1`-`9` and `0` (mapped to index 9) as quick-pick
 * shortcuts and shows a matching `[N]` chip next to the first 10 rows.
 * Lists with more than 10 options used to render that chip on rows
 * 1-10 only — rows 11+ looked identical to shortcut-enabled rows but
 * typing their visible number did nothing.
 *
 * Fix:
 *  - <=10 options → keep `[1]`-`[9]`/`[0]` chips and the digit handler.
 *  - >10 options  → drop the chip on EVERY row and surface a muted
 *    "Use arrows + Enter to pick" hint. The digit handler still
 *    responds for indices 0-9 so users who learned the shortcut don't
 *    lose it; the UI just stops advertising it.
 */

import React from 'react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { PickerMenu, PICKER_FLASH_MS } from '../PickerMenu.js';

const HINT_TEXT = 'Use arrows + Enter to pick';

const makeOptions = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    label: `Option ${i + 1}`,
    value: `v${i + 1}`,
  }));

describe('PickerMenu digit-shortcut UI for large lists', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows [N] chips and accepts digits when options.length <= 10', async () => {
    let chosen: string | string[] | null = null;
    const view = render(
      <PickerMenu
        options={makeOptions(5)}
        onSelect={(v) => (chosen = v as string)}
      />,
    );
    await vi.advanceTimersByTimeAsync(0);

    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('[1]');
    expect(frame).toContain('[3]');
    expect(frame).toContain('[5]');
    expect(frame).not.toContain(HINT_TEXT);

    // Typing `3` should commit index 2.
    view.stdin.write('3');
    // Drain the PICKER_FLASH_MS confirmation flash so onSelect fires.
    await vi.advanceTimersByTimeAsync(PICKER_FLASH_MS + 5);
    expect(chosen).toBe('v3');

    view.unmount();
  });

  it('drops all [N] chips and shows the arrows hint when options.length > 10', async () => {
    const view = render(
      <PickerMenu options={makeOptions(15)} onSelect={() => undefined} />,
    );
    await vi.advanceTimersByTimeAsync(0);

    const frame = view.lastFrame() ?? '';
    // None of the digit chips should appear anywhere — neither for the
    // visible shortcut-eligible rows (1-10) nor for the rest.
    for (let d = 0; d <= 9; d++) {
      expect(frame).not.toContain(`[${d}]`);
    }
    expect(frame).toContain(HINT_TEXT);

    view.unmount();
  });

  it('still accepts digit 3 for back-compat on a 15-option list', async () => {
    let chosen: string | string[] | null = null;
    const view = render(
      <PickerMenu
        options={makeOptions(15)}
        onSelect={(v) => (chosen = v as string)}
      />,
    );
    await vi.advanceTimersByTimeAsync(0);

    view.stdin.write('3');
    // Drain the PICKER_FLASH_MS confirmation flash so onSelect fires.
    await vi.advanceTimersByTimeAsync(PICKER_FLASH_MS + 5);
    expect(chosen).toBe('v3');

    view.unmount();
  });

  it('still accepts digit 0 → index 9 for back-compat on a 15-option list', async () => {
    let chosen: string | string[] | null = null;
    const view = render(
      <PickerMenu
        options={makeOptions(15)}
        onSelect={(v) => (chosen = v as string)}
      />,
    );
    await vi.advanceTimersByTimeAsync(0);

    view.stdin.write('0');
    // Drain the PICKER_FLASH_MS confirmation flash so onSelect fires.
    await vi.advanceTimersByTimeAsync(PICKER_FLASH_MS + 5);
    expect(chosen).toBe('v10');

    view.unmount();
  });
});
