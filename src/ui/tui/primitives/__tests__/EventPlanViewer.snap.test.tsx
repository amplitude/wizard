import React from 'react';
import { describe, expect, it } from 'vitest';
import { EventPlanViewer } from '../EventPlanViewer.js';
import {
  renderSnapshot,
  makeStoreForSnapshot,
} from '../../__tests__/snapshot-utils.js';

describe('EventPlanViewer snapshots', () => {
  it('renders the waiting state before any events are proposed', () => {
    const store = makeStoreForSnapshot();
    const { frame } = renderSnapshot(<EventPlanViewer events={[]} />, store);
    expect(frame).toMatchSnapshot();
  });

  it('renders visible events and skips blank names', () => {
    const store = makeStoreForSnapshot();
    const { frame } = renderSnapshot(
      <EventPlanViewer
        events={[
          {
            name: 'Project Created',
            description: 'Fires after successful project provisioning.',
          },
          { name: '   ', description: 'Should be hidden.' },
          {
            name: 'SDK Initialized',
            description: '',
          },
        ]}
      />,
      store,
    );
    expect(frame).toMatchSnapshot();
  });
});
