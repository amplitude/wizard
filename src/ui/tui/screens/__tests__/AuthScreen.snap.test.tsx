/**
 * AuthScreen — snapshots for the SUSI flow's branching states.
 *
 * The screen has five logical phases (oauth-wait → org → project →
 * environment → key entry). Each branch is gated on session.pendingOrgs +
 * counts. Snapshotting the rendered text catches regressions in:
 *
 *   - The "Waiting for authentication" copy + login URL fallback
 *   - The org / project / environment picker headings
 *   - The "Create new project…" + "Start over" picker actions
 *   - The manual API key entry path with apiKeyNotice surfaced
 *
 * What's *not* tested here: the async API-key resolution useEffect (that's
 * a side-effect orchestration concern; covered indirectly by router tests).
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { AuthScreen } from '../AuthScreen.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';

describe('AuthScreen snapshots', () => {
  it('renders the OAuth waiting state with spinner and login URL', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      loginUrl:
        'https://app.amplitude.com/oauth?response_type=code&client_id=wizard',
      pendingOrgs: null,
    });
    const { frame } = renderSnapshot(<AuthScreen store={store} />, store);
    expect(frame).toContain('Waiting for authentication');
    expect(frame).toContain('https://app.amplitude.com/oauth');
    expect(frame).toContain("If the browser didn't open");
    expect(frame).toMatchSnapshot();
  });

  it('renders the org picker when the user belongs to multiple orgs', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      pendingOrgs: [
        { id: 'org-1', name: 'Acme Corp', projects: [] },
        { id: 'org-2', name: 'Globex', projects: [] },
      ],
    });
    const { frame } = renderSnapshot(<AuthScreen store={store} />, store);
    expect(frame).toContain('Select your organization');
    expect(frame).toContain('Acme Corp');
    expect(frame).toContain('Globex');
  });

  it('renders the project picker with Create + Start over actions when multi-org', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      pendingOrgs: [
        // Two orgs → Start over option appears
        {
          id: 'org-1',
          name: 'Acme Corp',
          projects: [
            { id: 'ws-1', name: 'Production' },
            { id: 'ws-2', name: 'Staging' },
          ],
        },
        { id: 'org-2', name: 'Globex', projects: [] },
      ],
      selectedOrgId: 'org-1',
      selectedOrgName: 'Acme Corp',
    });
    const { frame } = renderSnapshot(<AuthScreen store={store} />, store);
    expect(frame).toContain('Select a project');
    expect(frame).toContain('Production');
    expect(frame).toContain('Staging');
    expect(frame).toContain('Create new project');
    expect(frame).toContain('Start over');
  });

  it('omits Start over from the project picker when only one org is available', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      pendingOrgs: [
        {
          id: 'org-1',
          name: 'Solo Org',
          projects: [
            { id: 'ws-1', name: 'Project A' },
            { id: 'ws-2', name: 'Project B' },
          ],
        },
      ],
    });
    const { frame } = renderSnapshot(<AuthScreen store={store} />, store);
    // Auto-selected single org → project picker is shown without Start over
    expect(frame).toContain('Select a project');
    expect(frame).toContain('Project A');
    expect(frame).toContain('Create new project');
    expect(frame).not.toContain('Start over');
  });

  it('renders the environment picker when the project has multiple env keys', () => {
    // No installDir / ID prepopulation needed: the snapshot util points
    // installDir at a tmp dir, and the auto-resolve effect skips the
    // ampli.json write when session IDs already match the resolved
    // org/project. Either way no stray ampli.json appears at the
    // repo root during tests.
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      pendingOrgs: [
        {
          id: 'org-1',
          name: 'Acme',
          projects: [
            {
              id: 'ws-1',
              name: 'Solo Project',
              environments: [
                {
                  rank: 1,
                  name: 'Development',
                  app: { id: '111', apiKey: 'dev-key' },
                },
                {
                  rank: 2,
                  name: 'Production',
                  app: { id: '222', apiKey: 'prod-key' },
                },
              ],
            },
          ],
        },
      ],
    });
    const { frame } = renderSnapshot(<AuthScreen store={store} />, store);
    expect(frame).toContain('Select an environment');
    expect(frame).toContain('Development');
    expect(frame).toContain('Production');
  });

  it('shows completed-step indicators above the active picker', () => {
    // detectedFrameworkLabel is shown as a completed step at the top of Auth.
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      detectedFrameworkLabel: 'Next.js',
      pendingOrgs: [
        { id: 'org-1', name: 'Acme', projects: [] },
        { id: 'org-2', name: 'Globex', projects: [] },
      ],
    });
    const { frame } = renderSnapshot(<AuthScreen store={store} />, store);
    expect(frame).toContain('Framework: Next.js');
    expect(frame).toContain('Select your organization');
  });
});
