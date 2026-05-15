/**
 * ScreenHotkeyBar — visual coverage at 80 / 60 / 40 cols.
 *
 * The hotkey rail is the primary discoverability surface for users
 * scanning "what can I press right now?". These tests pin:
 *   • The `[K] label` bracket idiom so a future refactor can't drop
 *     it (color is a redundancy, not the signal).
 *   • The truncation policy — first two pills are always preserved,
 *     tail pills drop with an ellipsis at < 60 cols.
 *   • Backward compat — `HotkeyPills` continues to render the same
 *     output via the re-export shim.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import {
  ScreenHotkeyBar,
  HotkeyPills,
  type HotkeyPill,
} from '../ScreenHotkeyBar.js';

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const frameOf = (el: React.ReactElement): string => {
  const { lastFrame, unmount } = render(el);
  const out = (lastFrame() ?? '').replace(ANSI, '');
  unmount();
  return out;
};

const PILLS: HotkeyPill[] = [
  { key: 'k', label: 'paste api key' },
  { key: '/', label: 'commands' },
  { key: 'Tab', label: 'ask' },
  { key: 'L', label: 'open log' },
  { key: 'C', label: 'bug report' },
];

describe('ScreenHotkeyBar', () => {
  it('renders nothing when given no pills', () => {
    expect(frameOf(<ScreenHotkeyBar pills={[]} width={80} />)).toBe('');
  });

  it('renders all pills inline at 80 cols (default)', () => {
    const out = frameOf(<ScreenHotkeyBar pills={PILLS} width={80} />);
    expect(out).toContain('[k] paste api key');
    expect(out).toContain('[/] commands');
    expect(out).toContain('[Tab] ask');
    expect(out).toContain('[L] open log');
    expect(out).toContain('[C] bug report');
    // No ellipsis when everything fits.
    expect(out).not.toContain('…');
  });

  it('keeps every pill visible at 60 cols (wraps instead of truncating)', () => {
    const out = frameOf(<ScreenHotkeyBar pills={PILLS} width={60} />);
    expect(out).toContain('[k] paste api key');
    expect(out).toContain('[/] commands');
    expect(out).toContain('[Tab] ask');
    expect(out).toContain('[L] open log');
    expect(out).toContain('[C] bug report');
    expect(out).not.toContain('…');
  });

  it('truncates tail pills with an ellipsis at 40 cols, preserving the first two', () => {
    const out = frameOf(<ScreenHotkeyBar pills={PILLS} width={40} />);
    // First two pills always survive.
    expect(out).toContain('[k] paste api key');
    expect(out).toContain('[/] commands');
    // Ellipsis is rendered.
    expect(out).toContain('…');
    // At least one of the trailing pills is dropped.
    const droppedAtLeastOne =
      !out.includes('[C] bug report') || !out.includes('[L] open log');
    expect(droppedAtLeastOne).toBe(true);
  });

  it('preserves order of rendered pills', () => {
    const out = frameOf(<ScreenHotkeyBar pills={PILLS} width={80} />);
    expect(out.indexOf('[k]')).toBeLessThan(out.indexOf('[/]'));
    expect(out.indexOf('[/]')).toBeLessThan(out.indexOf('[Tab]'));
  });

  it('preserves multi-char key labels like Esc', () => {
    const out = frameOf(
      <ScreenHotkeyBar pills={[{ key: 'Esc', label: 'Cancel' }]} width={80} />,
    );
    expect(out).toContain('[Esc] Cancel');
  });

  it('does not drop the first pill even on a very narrow terminal', () => {
    const out = frameOf(<ScreenHotkeyBar pills={PILLS} width={20} />);
    expect(out).toContain('[k] paste api key');
    expect(out).toContain('[/] commands');
  });
});

describe('HotkeyPills (backwards-compat shim)', () => {
  it('renders the same `[K] label` shape as ScreenHotkeyBar', () => {
    const a = frameOf(<HotkeyPills pills={[{ key: 'R', label: 'Retry' }]} />);
    const b = frameOf(
      <ScreenHotkeyBar pills={[{ key: 'R', label: 'Retry' }]} />,
    );
    expect(a).toBe(b);
  });

  it('renders nothing when given an empty pills array', () => {
    expect(frameOf(<HotkeyPills pills={[]} />)).toBe('');
  });
});
