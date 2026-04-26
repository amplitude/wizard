import React from 'react';
import { describe, it, expect } from 'vitest';
import { OutroScreen } from '../OutroScreen.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';
import { OutroKind } from '../../session-constants.js';

describe('OutroScreen snapshots', () => {
  it('renders the success state with changes + continue link', () => {
    const store = makeStoreForSnapshot({
      outroData: {
        kind: OutroKind.Success,
        changes: [
          'Installed @amplitude/analytics-browser',
          'Added .env.local with AMPLITUDE_API_KEY',
          'Added 3 planned events to your tracking plan',
        ],
        docsUrl: 'https://amplitude.com/docs/get-started/quickstart',
        continueUrl:
          'https://app.amplitude.com/analytics/amplitude/project/769610',
      },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toMatchSnapshot();
  });

  it('renders the error state with a message and docs fallback', () => {
    const store = makeStoreForSnapshot({
      outroData: {
        kind: OutroKind.Error,
        message:
          'The agent could not detect your framework. Re-run with --menu to pick one manually.',
        docsUrl: 'https://amplitude.com/docs/get-started/quickstart',
      },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toMatchSnapshot();
  });

  it('renders the cancel state', () => {
    const store = makeStoreForSnapshot({
      outroData: {
        kind: OutroKind.Cancel,
        message: 'Setup cancelled.',
        docsUrl: 'https://amplitude.com/docs/get-started/quickstart',
      },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toMatchSnapshot();
  });
});
