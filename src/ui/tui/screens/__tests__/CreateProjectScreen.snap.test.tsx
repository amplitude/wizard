/**
 * CreateProjectScreen — inline /create-project flow.
 *
 * Validates the heading, idle prompt, and the org-context line so that
 * a regression on the "in <orgName>" sub-heading (which has shipped twice
 * with the wrong color or a missing italic) is caught.
 *
 * The submitting/error phases are component-internal state — we stick
 * with the idle phase here. Phase transitions are exercised by the
 * router/store tests.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { CreateProjectScreen } from '../CreateProjectScreen.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';

describe('CreateProjectScreen snapshots', () => {
  it('renders the idle prompt with org-context line and Enter/Esc helper', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      selectedOrgId: 'org-1',
      selectedOrgName: 'Acme Corp',
      createProject: {
        pending: true,
        source: 'slash',
        suggestedName: null,
      },
      pendingAuthAccessToken: 'tok',
      pendingAuthIdToken: 'id',
    });
    const { frame } = renderSnapshot(
      <CreateProjectScreen store={store} />,
      store,
    );
    expect(frame).toContain('Create a new Amplitude project');
    expect(frame).toContain('in');
    expect(frame).toContain('Acme Corp');
    expect(frame).toContain('Project name');
    expect(frame).toContain('Press Enter to create, Esc to go back');
    expect(frame).toMatchSnapshot();
  });

  it('does not show the org-context line when org name is unknown', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      createProject: {
        pending: true,
        source: 'slash',
        suggestedName: null,
      },
      pendingAuthAccessToken: 'tok',
      pendingAuthIdToken: 'id',
    });
    const { frame } = renderSnapshot(
      <CreateProjectScreen store={store} />,
      store,
    );
    expect(frame).toContain('Create a new Amplitude project');
    // No "in" line when the org isn't resolved
    expect(frame).not.toMatch(/^\s*in\s*$/m);
  });

  it('seeds the input with the suggested name from the slash command', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      selectedOrgName: 'Acme',
      createProject: {
        pending: true,
        source: 'slash',
        suggestedName: 'My Cool Project',
      },
      pendingAuthAccessToken: 'tok',
      pendingAuthIdToken: 'id',
    });
    const { frame } = renderSnapshot(
      <CreateProjectScreen store={store} />,
      store,
    );
    // Suggested name is loaded into the TextInput defaultValue.
    expect(frame).toContain('My Cool Project');
  });
});
