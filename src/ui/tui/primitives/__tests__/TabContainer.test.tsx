/**
 * TabContainer — locks down the responsive tab-bar contract.
 *
 * Recent regression (screenshot at ~30 cols):
 *
 *     Progr           Snake  ← → to
 *     ess  Logs(WASD)        switch
 *                            tabs
 *
 * "Progress" wrapped to "Progr / ess", "Snake (WASD)" got smushed into
 * "Snake / (WASD)", and the right-side "← → to switch tabs" hint
 * shoved everything around. After the fix, narrow widths render
 * compact single-word labels and drop the right-side hint entirely.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { TabContainer, compactTabLabel } from '../TabContainer.js';

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const stripAnsi = (s: string): string => s.replace(ANSI, '');

const tabs = [
  { id: 'progress', label: 'Progress', component: <></> },
  { id: 'logs', label: 'Logs', component: <></> },
  { id: 'snake', label: 'Snake (WASD)', component: <></> },
];

const renderAtWidth = (width: number): string => {
  const { lastFrame, unmount } = render(
    <TabContainer tabs={tabs} widthOverride={width} />,
  );
  const out = stripAnsi(lastFrame() ?? '');
  unmount();
  return out;
};

describe('compactTabLabel', () => {
  it('returns the first word, capped at 5 chars', () => {
    expect(
      compactTabLabel({ id: 'a', label: 'Snake (WASD)', component: null }),
    ).toBe('Snake');
    expect(
      compactTabLabel({ id: 'a', label: 'Progress', component: null }),
    ).toBe('Progr');
    expect(compactTabLabel({ id: 'a', label: 'Logs', component: null })).toBe(
      'Logs',
    );
  });

  it('prefers an explicit shortLabel when present', () => {
    expect(
      compactTabLabel({
        id: 'a',
        label: 'Progress',
        component: null,
        shortLabel: 'P',
      }),
    ).toBe('P');
  });
});

describe('TabContainer', () => {
  it('renders compact tab labels at narrow widths (no word-wrap of "Snake (WASD)")', () => {
    const out = renderAtWidth(30);
    // First-word-truncated forms only — full labels should not appear.
    expect(out).toContain('Snake');
    expect(out).not.toContain('(WASD)');
    expect(out).toContain('Progr');
    expect(out).not.toContain('Progress');
    expect(out).toContain('Logs');
  });

  it('drops the "← → to switch tabs" hint at narrow widths', () => {
    const out = renderAtWidth(40);
    expect(out).not.toContain('switch tabs');
  });

  it('renders the switch-tabs hint at wide widths', () => {
    const out = renderAtWidth(120);
    expect(out).toContain('← → to switch tabs');
    // And uses full labels.
    expect(out).toContain('Progress');
    expect(out).toContain('Snake (WASD)');
  });

  it.each([25, 40, 60, 100, 160])(
    'tab labels never wrap mid-word at width=%i',
    (width) => {
      const out = renderAtWidth(width);
      // Words we never want wrapped:
      const wholeTokens = ['Progr', 'Logs', 'Snake'];
      // Either compact or full should appear, never split.
      // We assert the chosen label is present as a contiguous substring.
      const hasProgress = out.includes('Progress') || out.includes('Progr');
      const hasLogs = out.includes('Logs');
      const hasSnake = out.includes('Snake');
      expect(hasProgress).toBe(true);
      expect(hasLogs).toBe(true);
      expect(hasSnake).toBe(true);
      // None of the broken split forms from the bug should show up.
      expect(out).not.toMatch(/Progr\n\s*ess/);
      // 'wholeTokens' is referenced for documentation; assertion above
      // covers the contract.
      void wholeTokens;
    },
  );
});
