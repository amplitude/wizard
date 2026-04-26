/**
 * DataSetupScreen — fired between Auth and Run while the wizard probes the
 * Amplitude Data API for activation level. Visually it's a single spinner +
 * heading + helper line — the snapshot guards the headline copy and tagline
 * so someone shipping a "rebrand the loading state" PR can't sneak a regression
 * through without an explicit `pnpm test -u` review.
 *
 * The async useEffect inside the component reads from `store.session` and
 * triggers a network call. We never mount with credentials populated, so
 * the effect short-circuits and the rendered frame is deterministic.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { DataSetupScreen } from '../DataSetupScreen.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';

describe('DataSetupScreen snapshots', () => {
  it('renders the loading state with heading + spinner + helper line', () => {
    // No credentials → useEffect short-circuits to setActivationLevel('none')
    // synchronously, but the first render frame is still the spinner pane.
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
    });
    const { frame } = renderSnapshot(<DataSetupScreen store={store} />, store);
    expect(frame).toContain('Checking project setup');
    expect(frame).toContain('Analyzing your Amplitude project');
    expect(frame).toContain('Looking for existing SDK installation');
    expect(frame).toMatchSnapshot();
  });
});
