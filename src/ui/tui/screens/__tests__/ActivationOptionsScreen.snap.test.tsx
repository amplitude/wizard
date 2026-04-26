/**
 * ActivationOptionsScreen — shown when the project has the SDK installed
 * but few/no events. The picker copy ("installed" vs "partially set up")
 * branches on snippetConfigured. Snapshot both paths so a copy-edit on one
 * side doesn't silently regress the other.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { ActivationOptionsScreen } from '../ActivationOptionsScreen.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';

describe('ActivationOptionsScreen snapshots', () => {
  it('renders the "installed - waiting for events" headline when snippet is configured', () => {
    const store = makeStoreForSnapshot({
      snippetConfigured: true,
      activationLevel: 'partial',
      projectHasData: false,
    });
    const { frame } = renderSnapshot(
      <ActivationOptionsScreen store={store} />,
      store,
    );
    expect(frame).toContain('Your SDK is installed');
    expect(frame).not.toContain('partially set up');
    expect(frame).toMatchSnapshot();
  });

  it('renders the "partially set up" headline when snippet is not configured', () => {
    const store = makeStoreForSnapshot({
      snippetConfigured: false,
      activationLevel: 'partial',
      projectHasData: false,
    });
    const { frame } = renderSnapshot(
      <ActivationOptionsScreen store={store} />,
      store,
    );
    expect(frame).toContain('Your SDK is partially set up');
    expect(frame).toMatchSnapshot();
  });

  it('shows the four canonical actions in the picker', () => {
    const store = makeStoreForSnapshot({
      snippetConfigured: true,
      activationLevel: 'partial',
      projectHasData: false,
    });
    const { frame } = renderSnapshot(
      <ActivationOptionsScreen store={store} />,
      store,
    );
    expect(frame).toContain('Help me test locally');
    expect(frame).toContain("I'm blocked");
    expect(frame).toContain('Take me to the docs');
    expect(frame).toContain("I'm done for now");
  });
});
