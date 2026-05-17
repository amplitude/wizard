import React from 'react';
import { Box, Text } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import {
  renderSnapshot,
  makeStoreForSnapshot,
} from '../../__tests__/snapshot-utils.js';
import { ProgressList } from '../ProgressList.js';

vi.mock('@inkjs/ui', () => ({
  Spinner: () => <Text>spinner</Text>,
}));

import { stripAnsi } from '../../__tests__/helpers/strip-ansi.js';

describe('ProgressList snapshots', () => {
  it('renders the empty loading state', () => {
    const store = makeStoreForSnapshot();
    const { frame } = renderSnapshot(
      <ProgressList items={[]} title="Tasks" />,
      store,
    );
    expect(frame).toMatchSnapshot();
  });

  it('renders mixed task states with progress footer', () => {
    const store = makeStoreForSnapshot();
    const { frame } = renderSnapshot(
      <Box width={60}>
        <ProgressList
          title="Tasks"
          items={[
            { label: 'Detect framework', status: 'completed' },
            {
              label: 'Create project',
              activeForm: 'Creating project...',
              status: 'in_progress',
            },
            {
              label:
                'Write a very long instrumentation checklist item that should wrap without breaking the icon gutter',
              status: 'pending',
            },
          ]}
        />
      </Box>,
      store,
    );
    expect(frame).toMatchSnapshot();
  });
});

describe('ProgressList narrow-terminal label rendering', () => {
  // Pin: an in-progress row with both a canonical `label` and an
  // `activeForm` MUST render only the activeForm — never the two
  // concatenated. Caught a regression report on ~30-col terminals where
  // the task list rendered `Wiring up event trackingto track` instead
  // of just `Wiring up event tracking` (the activeForm) above the
  // wrapped tail of the previous row's label.
  //
  // Whitespace-collapsed form of the frame is used so the assertion
  // survives Ink's terminal-width-driven line wrapping (which can split
  // "Wiring up event tracking" into two lines at very narrow widths).
  for (const width of [25, 30, 35, 40, 60]) {
    it(`renders only the activeForm (not the canonical label) at ${width} cols`, () => {
      const { lastFrame, unmount } = render(
        <Box width={width}>
          <ProgressList
            title="Tasks"
            items={[
              {
                label: 'Detect your project setup',
                status: 'completed',
              },
              { label: 'Install Amplitude', status: 'completed' },
              {
                label: 'Plan and approve events to track',
                status: 'completed',
              },
              {
                label: 'Wire up event tracking',
                activeForm: 'Wiring up event tracking',
                status: 'in_progress',
              },
            ]}
          />
        </Box>,
      );
      const frame = stripAnsi(lastFrame() ?? '');
      const flat = frame.replace(/\s+/g, ' ').trim();
      unmount();

      // Active form is present (after collapsing wrap whitespace).
      expect(flat).toContain('Wiring up event tracking');
      // Canonical "Wire up event tracking" of the active step is NOT
      // rendered next to its own activeForm. (Note: the *previous*
      // step's canonical label "Plan and approve events to track" IS
      // expected to render — that's a completed row, separate line.)
      expect(flat).not.toContain('Wire up event tracking');
      // Belt-and-braces: the smush pattern from the bug report. The
      // active row must never produce `trackingto` or `trackingWire` —
      // both are visible failure modes when the activeForm and the
      // canonical label get concatenated without a separator.
      expect(flat).not.toMatch(/trackingto/);
      expect(flat).not.toMatch(/trackingWire/);
    });
  }
});
