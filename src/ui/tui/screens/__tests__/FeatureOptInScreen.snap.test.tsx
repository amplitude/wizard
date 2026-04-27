/**
 * FeatureOptInScreen — multi-select picklist for additional features
 * (Session Replay, LLM analytics, Engagement). Renders only when
 * discoveredFeatures has at least one matching entry — otherwise it
 * auto-advances via store.confirmFeatureOptIns([]).
 *
 * Coverage:
 *   - The empty state renders nothing (snapshot is empty) so the screen
 *     can't deadlock the flow.
 *   - With Session Replay + LLM discovered, both labels + their hint
 *     copy show up. The picker defaults to NOTHING checked — these are
 *     explicit opt-ins (SR has privacy implications, G&S adds a runtime
 *     surface, LLM adds tracking dependencies).
 *   - The Engagement-only case verifies the third option label, which
 *     was added later than the others (#236).
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { FeatureOptInScreen } from '../FeatureOptInScreen.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';
import { DiscoveredFeature } from '../../../../lib/wizard-session.js';

describe('FeatureOptInScreen snapshots', () => {
  it('renders nothing when no opt-in features have been discovered', () => {
    const store = makeStoreForSnapshot({ discoveredFeatures: [] });
    const { frame } = renderSnapshot(
      <FeatureOptInScreen store={store} />,
      store,
    );
    expect(frame.trim()).toBe('');
  });

  it('lists Session Replay + LLM with hint copy when both are discovered', () => {
    const store = makeStoreForSnapshot({
      discoveredFeatures: [
        DiscoveredFeature.SessionReplay,
        DiscoveredFeature.LLM,
      ],
    });
    const { frame } = renderSnapshot(
      <FeatureOptInScreen store={store} />,
      store,
    );
    expect(frame).toContain('Optional add-ons');
    expect(frame).toContain('None are checked by default');
    expect(frame).toContain('Watch user sessions like a video');
    expect(frame).toContain('Track AI agent calls');
    // ESC affordance must be visible — without it the user has no way to skip.
    expect(frame).toContain('ESC to skip');
    expect(frame).toMatchSnapshot();
  });

  it('renders the Engagement opt-in label when Engagement is the only discovery', () => {
    const store = makeStoreForSnapshot({
      discoveredFeatures: [DiscoveredFeature.Engagement],
    });
    const { frame } = renderSnapshot(
      <FeatureOptInScreen store={store} />,
      store,
    );
    expect(frame).toContain('In-product NPS, surveys, and tours');
  });

  it('does not show Stripe in the picklist (Stripe is not opt-in)', () => {
    // Stripe is a discovered feature but only renders as a tip on RunScreen.
    // Verifying that toAdditionalFeature filters it out.
    const store = makeStoreForSnapshot({
      discoveredFeatures: [DiscoveredFeature.Stripe],
    });
    const { frame } = renderSnapshot(
      <FeatureOptInScreen store={store} />,
      store,
    );
    expect(frame.trim()).toBe('');
  });
});
