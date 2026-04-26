import React from 'react';
import { Box, Text } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import {
  renderSnapshot,
  makeStoreForSnapshot,
} from '../../__tests__/snapshot-utils.js';
import { ProgressList } from '../ProgressList.js';

vi.mock('@inkjs/ui', () => ({
  Spinner: () => <Text>spinner</Text>,
}));

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
