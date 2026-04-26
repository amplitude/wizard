/**
 * HeaderBar — verify the org / workspace / env breadcrumb composition.
 *
 * Why this matters: the header is the user's only persistent visual hint
 * about which Amplitude project they're targeting. A null leak ("Acme //
 * Production") or wrong delimiter has shipped twice in 2026 and was caught
 * by users, not tests.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { HeaderBar } from '../HeaderBar.js';

// eslint-disable-next-line no-control-regex
const ANSI_CSI = /\x1b\[[0-9;]*[A-Za-z]/g;
// eslint-disable-next-line no-control-regex
const ANSI_OSC = /\x1b\][^\x07]*\x07/g;
const frameOf = (node: React.ReactElement): string => {
  const { lastFrame, unmount } = render(node);
  const out = (lastFrame() ?? '').replace(ANSI_CSI, '').replace(ANSI_OSC, '');
  unmount();
  return out;
};

describe('HeaderBar', () => {
  it('renders the wizard title with no breadcrumb when no context is provided', () => {
    const out = frameOf(<HeaderBar width={80} />);
    expect(out).toContain('Amplitude Wizard');
    expect(out).not.toContain(' / ');
  });

  it('joins org, workspace, env with a slash separator', () => {
    const out = frameOf(
      <HeaderBar
        width={80}
        orgName="Acme"
        workspaceName="Amplitude"
        envName="Production"
      />,
    );
    expect(out).toContain('Acme / Amplitude / Production');
  });

  it('omits null/undefined parts cleanly without leaving extra slashes', () => {
    const out = frameOf(
      <HeaderBar
        width={80}
        orgName="Acme"
        workspaceName={null}
        envName="Production"
      />,
    );
    expect(out).toContain('Acme / Production');
    expect(out).not.toMatch(/\/\s+\//); // no "/ /"
    expect(out).not.toContain('null');
  });

  it('renders just the org when only org is known (mid-auth)', () => {
    const out = frameOf(<HeaderBar width={80} orgName="Acme" />);
    expect(out).toContain('Acme');
    expect(out).not.toContain(' / ');
  });

  it('renders identically when nullish values are passed explicitly', () => {
    // Defensive: callers sometimes pass `null` rather than omitting the prop.
    const out = frameOf(
      <HeaderBar
        width={80}
        orgName={null}
        workspaceName={null}
        envName={null}
      />,
    );
    expect(out).toContain('Amplitude Wizard');
    expect(out).not.toContain('null');
    expect(out).not.toContain(' / ');
  });
});
