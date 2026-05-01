import React from 'react';
import { describe, it, expect } from 'vitest';
import { RegionSelectScreen } from '../RegionSelectScreen.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';

describe('RegionSelectScreen snapshots', () => {
  it('renders the first-time region picker (US/EU)', () => {
    const store = makeStoreForSnapshot();
    const { frame } = renderSnapshot(
      <RegionSelectScreen store={store} />,
      store,
    );
    expect(frame).toMatchSnapshot();
  });

  it('renders the /region-forced switch with current region surfaced', () => {
    const store = makeStoreForSnapshot({
      regionForced: true,
      region: 'us',
    });
    const { frame } = renderSnapshot(
      <RegionSelectScreen store={store} />,
      store,
    );
    expect(frame).toMatchSnapshot();
  });
});
