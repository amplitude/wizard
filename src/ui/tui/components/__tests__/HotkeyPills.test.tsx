/**
 * HotkeyPills — visual coverage.
 *
 * The pill bar is the primary affordance on the error outro for users
 * looking for "what can I press right now?". These tests pin the
 * rendered shape so a future copy or color refactor can't quietly drop
 * the `[K] label` idiom that gives the bar its scan-ability.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { HotkeyPills } from '../HotkeyPills.js';

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const frameOf = (el: React.ReactElement): string => {
  const { lastFrame, unmount } = render(el);
  const out = (lastFrame() ?? '').replace(ANSI, '');
  unmount();
  return out;
};

describe('HotkeyPills', () => {
  it('renders nothing when given no pills', () => {
    expect(frameOf(<HotkeyPills pills={[]} />)).toBe('');
  });

  it('renders a single [key] label pill', () => {
    const out = frameOf(
      <HotkeyPills pills={[{ key: 'L', label: 'Open log' }]} />,
    );
    expect(out).toContain('[L]');
    expect(out).toContain('Open log');
  });

  it('renders multiple pills in a single row with consistent shape', () => {
    const out = frameOf(
      <HotkeyPills
        pills={[
          { key: 'R', label: 'Retry' },
          { key: 'L', label: 'Open log' },
          { key: 'C', label: 'Write bug report' },
        ]}
      />,
    );
    // Each pill renders as `[K] label` in order — pinning the shape so
    // a future refactor can't quietly drop the bracket idiom.
    expect(out).toContain('[R] Retry');
    expect(out).toContain('[L] Open log');
    expect(out).toContain('[C] Write bug report');
    // Ordering is preserved.
    expect(out.indexOf('[R]')).toBeLessThan(out.indexOf('[L]'));
    expect(out.indexOf('[L]')).toBeLessThan(out.indexOf('[C]'));
  });

  it('preserves multi-char key labels like Esc', () => {
    const out = frameOf(
      <HotkeyPills pills={[{ key: 'Esc', label: 'Cancel' }]} />,
    );
    expect(out).toContain('[Esc] Cancel');
  });
});
