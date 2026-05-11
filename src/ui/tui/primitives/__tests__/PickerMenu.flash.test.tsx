/**
 * PickerMenu selection-flash behaviour test.
 *
 * On Enter (and on a digit shortcut), the single-select PickerMenu
 * defers the `onSelect` callback by PICKER_FLASH_MS so the chosen row
 * can render with an accent background — visual confirmation that the
 * keystroke registered. After the flash expires, `onSelect` fires with
 * the chosen value. Input is locked during the flash so a follow-up
 * keystroke can't double-fire.
 *
 * We use fake timers and ink-testing-library so the 250 ms wait is
 * deterministic and instant on CI.
 */

import React from 'react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { PickerMenu, PICKER_FLASH_MS } from '../PickerMenu.js';

describe('PickerMenu selection flash', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const OPTIONS = [
    { label: 'Alpha', value: 'a' },
    { label: 'Beta', value: 'b' },
    { label: 'Gamma', value: 'c' },
  ];

  it('delays onSelect by PICKER_FLASH_MS after Enter is pressed', async () => {
    let chosen: string | string[] | null = null;
    const view = render(
      <PickerMenu options={OPTIONS} onSelect={(v) => (chosen = v as string)} />,
    );

    // Flush mount effects.
    await vi.advanceTimersByTimeAsync(0);

    // Default focus is index 0 (Alpha). Press Enter to commit.
    view.stdin.write('\r');
    await vi.advanceTimersByTimeAsync(0);

    // Before the flash window expires onSelect must NOT have fired.
    await vi.advanceTimersByTimeAsync(PICKER_FLASH_MS - 1);
    expect(chosen).toBeNull();

    // One more tick — flash expires, onSelect fires with the focused
    // option's value.
    await vi.advanceTimersByTimeAsync(2);
    expect(chosen).toBe('a');

    view.unmount();
  });

  it('locks input during the flash window so a second keystroke does not double-fire', async () => {
    let callCount = 0;
    let lastChoice: string | string[] | null = null;
    const view = render(
      <PickerMenu
        options={OPTIONS}
        onSelect={(v) => {
          callCount += 1;
          lastChoice = v;
        }}
      />,
    );
    await vi.advanceTimersByTimeAsync(0);

    // Commit with the `2` shortcut (Beta, index 1).
    view.stdin.write('2');
    await vi.advanceTimersByTimeAsync(10);

    // Spam Enter and digits during the flash window — none should
    // register; the choice is locked in.
    view.stdin.write('\r');
    view.stdin.write('3');
    view.stdin.write('1');
    await vi.advanceTimersByTimeAsync(50);

    // Still no onSelect call until the flash timer fires.
    expect(callCount).toBe(0);

    await vi.advanceTimersByTimeAsync(PICKER_FLASH_MS);
    expect(callCount).toBe(1);
    expect(lastChoice).toBe('b');

    view.unmount();
  });

  it('clears the flash timer on unmount so onSelect never fires after the picker goes away', async () => {
    let chosen: string | string[] | null = null;
    const view = render(
      <PickerMenu options={OPTIONS} onSelect={(v) => (chosen = v as string)} />,
    );
    await vi.advanceTimersByTimeAsync(0);

    view.stdin.write('\r');
    await vi.advanceTimersByTimeAsync(10);

    // Unmount mid-flash — simulates the parent flow advancing or the
    // user cancelling before the 250 ms window expires.
    view.unmount();

    await vi.advanceTimersByTimeAsync(PICKER_FLASH_MS * 4);
    expect(chosen).toBeNull();
  });
});
