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
import { describe, it, expect } from 'vitest';
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
});
