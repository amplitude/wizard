/**
 * HeaderBar — mode badge rendering tests.
 *
 * Validates that the v2 PR 5 mode badge surfaces correctly per
 * execution mode, and is suppressed in plain interactive mode.
 */
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { HeaderBar } from '../HeaderBar.js';
import { ModeBadge } from '../../styles.js';

describe('HeaderBar mode badge', () => {
  it('hides the badge in interactive mode', () => {
    const { lastFrame } = render(
      <HeaderBar
        width={120}
        mode={{ key: 'interactive', label: 'interactive', color: '#fff' }}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('[interactive]');
  });

  it('shows agent badge in agent mode', () => {
    const { lastFrame } = render(
      <HeaderBar
        width={120}
        mode={{ ...ModeBadge.agent, key: 'agent' }}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[');
    expect(frame).toContain('agent');
    expect(frame).toContain(']');
  });

  it('shows ci badge in ci mode', () => {
    const { lastFrame } = render(
      <HeaderBar
        width={120}
        mode={{ ...ModeBadge.ci, key: 'ci' }}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('ci');
  });

  it('shows nested badge when inside another agent', () => {
    const { lastFrame } = render(
      <HeaderBar
        width={120}
        mode={{ ...ModeBadge['nested-agent'], key: 'nested-agent' }}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('nested');
  });

  it('renders org/project/env context alongside the badge', () => {
    const { lastFrame } = render(
      <HeaderBar
        width={120}
        orgName="Acme"
        projectName="WebApp"
        envName="Production"
        mode={{ ...ModeBadge.agent, key: 'agent' }}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Acme');
    expect(frame).toContain('WebApp');
    expect(frame).toContain('Production');
    expect(frame).toContain('agent');
  });
});
