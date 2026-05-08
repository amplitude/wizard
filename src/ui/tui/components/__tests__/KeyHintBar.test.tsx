/**
 * KeyHintBar — verify the always-on hints (`/` Commands, Tab Ask) and
 * per-screen hint composition. Recent regressions:
 *
 *   - PR #240 made each screen register its own hints. Earlier versions
 *     duplicated `/` Commands when a screen forgot to suppress defaults.
 *   - The `showAskHint` flag is required pre-auth (Tab-to-ask hits the
 *     gateway with no credentials — we hide the hint until login).
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { KeyHintBar } from '../KeyHintBar.js';

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const frameOf = (node: React.ReactElement): string => {
  const { lastFrame, unmount } = render(node);
  const out = (lastFrame() ?? '').replace(ANSI, '');
  unmount();
  return out;
};

describe('KeyHintBar', () => {
  it('renders the default Commands + Ask hints when no per-screen hints are given', () => {
    const out = frameOf(<KeyHintBar width={80} />);
    expect(out).toContain('Commands');
    expect(out).toContain('Ask a question');
    expect(out).toContain('[/]');
    expect(out).toContain('[Tab]');
  });

  it('hides the Ask hint when showAskHint is false (pre-auth screens)', () => {
    const out = frameOf(<KeyHintBar width={80} showAskHint={false} />);
    expect(out).toContain('Commands');
    expect(out).not.toContain('Ask a question');
  });

  it('drops both defaults when showDefaults is false', () => {
    const out = frameOf(<KeyHintBar width={80} showDefaults={false} />);
    expect(out).not.toContain('Commands');
    expect(out).not.toContain('Ask a question');
  });

  it('appends per-screen hints before the defaults', () => {
    const out = frameOf(
      <KeyHintBar width={80} hints={[{ key: 'Enter', label: 'Continue' }]} />,
    );
    expect(out).toContain('[Enter]');
    expect(out).toContain('Continue');
    // Order: per-screen first, defaults last
    expect(out.indexOf('Continue')).toBeLessThan(out.indexOf('Commands'));
  });

  it('renders multiple per-screen hints in registration order', () => {
    const out = frameOf(
      <KeyHintBar
        width={80}
        hints={[
          { key: '↑↓', label: 'Navigate' },
          { key: 'Enter', label: 'Select' },
        ]}
        showDefaults={false}
      />,
    );
    expect(out.indexOf('Navigate')).toBeLessThan(out.indexOf('Select'));
  });

  it('renders an empty hints list without producing default hint pollution', () => {
    // showDefaults defaults to true even with an empty hints list — verify
    // the bar still surfaces the `/` Commands hint so a screen that forgets
    // to register its own hints is still discoverable.
    const out = frameOf(<KeyHintBar width={80} hints={[]} />);
    expect(out).toContain('[/]');
    expect(out).toContain('Commands');
  });

  it('switches to compact mode below the COMPACT_THRESHOLD', () => {
    // At 30 cols (well below 60), full "[Tab] Ask a question" used to
    // word-wrap into "[T-Ctrl] Ca-/] Com-Tab] Ask a / abs +C ncel mands
    // questi / on" — single tokens torn across rows. Verify the compact
    // forms render and no default hint label appears in long form.
    const out = frameOf(<KeyHintBar width={30} />);
    expect(out).toContain('cmds');
    expect(out).not.toContain('Commands');
    expect(out).not.toContain('Ask a question');
  });

  it('uses compact key forms in compact mode', () => {
    const out = frameOf(
      <KeyHintBar
        width={30}
        hints={[{ key: 'Ctrl+C', label: 'Cancel' }]}
        showDefaults={false}
      />,
    );
    expect(out).toContain('^C');
    expect(out).toContain('cancel');
    // Bracketed full form should NOT appear at narrow widths.
    expect(out).not.toContain('[Ctrl+C]');
  });

  it('keeps single-token hints intact (no word-wrap of "Cancel")', () => {
    // The bug from the screenshot: at 30 cols Ink's word-wrap split
    // "Cancel" into "Ca / ncel" and "Commands" into "Com- / mands".
    // After the fix, every visible hint must appear on a single line.
    const out = frameOf(
      <KeyHintBar width={30} hints={[{ key: 'Ctrl+C', label: 'Cancel' }]} />,
    );
    const lines = out.split('\n').filter((l) => l.trim().length > 0);
    // Bar renders as exactly one line.
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('cancel');
    expect(lines[0]).toContain('cmds');
  });

  it('drops optional hints first under MIN_THRESHOLD', () => {
    const out = frameOf(
      <KeyHintBar
        width={25}
        hints={[
          { key: 'Ctrl+C', label: 'Cancel' },
          { key: 'X', label: 'Extra', optional: true },
        ]}
      />,
    );
    expect(out).toContain('cancel');
    expect(out).not.toContain('extra');
  });

  it('renders the full bracketed form at wide widths (≥ COMPACT_THRESHOLD)', () => {
    const out = frameOf(<KeyHintBar width={120} />);
    expect(out).toContain('[/]');
    expect(out).toContain('[Tab]');
    expect(out).toContain('Commands');
    expect(out).toContain('Ask a question');
  });

  it.each([25, 40, 60, 100, 160])(
    'never word-wraps single-token labels at width=%i',
    (width) => {
      const out = frameOf(
        <KeyHintBar
          width={width}
          hints={[
            { key: 'Ctrl+C', label: 'Cancel' },
            { key: '←→', label: 'Tabs', optional: true },
          ]}
        />,
      );
      const lines = out.split('\n').filter((l) => l.trim().length > 0);
      // Bar must always render as a single visible row.
      expect(lines.length).toBe(1);
    },
  );

  it('does not warn about duplicate React keys when a screen registers a hint that collides with the defaults', () => {
    // Regression: a screen registering its own `/ Commands` hint used to
    // collide with the always-on default, producing a noisy "Encountered
    // two children with the same key" React warning.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { unmount } = render(
        <KeyHintBar width={80} hints={[{ key: '/', label: 'Commands' }]} />,
      );
      unmount();
      const sawDuplicateKeyWarning = errorSpy.mock.calls.some((args) =>
        args.some(
          (arg) =>
            typeof arg === 'string' &&
            arg.includes('two children with the same key'),
        ),
      );
      expect(sawDuplicateKeyWarning).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
