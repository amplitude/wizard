/**
 * SlackScreen — Slack integration prompt + region-aware copy.
 *
 * The screen reads `useResolvedZone(session)` to decide whether to show the
 * "Amplitude" or "Amplitude - EU" Slack app. We snapshot the US default plus
 * the EU-warning variant so the localised copy can't silently regress.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { SlackScreen } from '../SlackScreen.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';

describe('SlackScreen snapshots', () => {
  it('renders the US prompt with the default Amplitude Slack app name', () => {
    const store = makeStoreForSnapshot({ region: 'us' });
    const { frame } = renderSnapshot(<SlackScreen store={store} />, store);
    expect(frame).toContain('Slack Integration');
    expect(frame).toContain('Connect the "Amplitude" Slack app');
    expect(frame).not.toContain('Amplitude - EU');
    expect(frame).not.toContain('EU region:');
    expect(frame).toContain('Skip for now');
    expect(frame).toMatchSnapshot();
  });

  it('renders the EU warning + "Amplitude - EU" app name on the EU zone', () => {
    const store = makeStoreForSnapshot({ region: 'eu' });
    const { frame } = renderSnapshot(<SlackScreen store={store} />, store);
    expect(frame).toContain('Connect the "Amplitude - EU" Slack app');
    expect(frame).toContain('EU region: install the "Amplitude - EU" app');
  });

  it('keeps the chart-preview / tracking-plan benefit copy on both regions', () => {
    // The benefit copy is region-independent — make sure neither branch drops it.
    const us = renderSnapshot(
      <SlackScreen store={makeStoreForSnapshot({ region: 'us' })} />,
      makeStoreForSnapshot({ region: 'us' }),
    );
    const eu = renderSnapshot(
      <SlackScreen store={makeStoreForSnapshot({ region: 'eu' })} />,
      makeStoreForSnapshot({ region: 'eu' }),
    );
    for (const out of [us.frame, eu.frame]) {
      expect(out).toContain('chart previews');
      expect(out).toContain('real-time tracking plan notifications');
    }
  });
});
