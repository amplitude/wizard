import React from 'react';
import { describe, it, expect } from 'vitest';
import { SettingsOverrideScreen } from '../SettingsOverrideScreen.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';

describe('SettingsOverrideScreen snapshots', () => {
  it('renders nothing when no settings overrides are detected', () => {
    const store = makeStoreForSnapshot();
    const { frame } = renderSnapshot(
      <SettingsOverrideScreen store={store} />,
      store,
    );
    expect(frame).toMatchSnapshot();
  });

  it('renders the conflict modal when settings override blocking env vars', () => {
    const store = makeStoreForSnapshot({
      settingsOverrideKeys: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN'],
    });
    const { frame } = renderSnapshot(
      <SettingsOverrideScreen store={store} />,
      store,
    );
    expect(frame).toMatchSnapshot();
  });
});
