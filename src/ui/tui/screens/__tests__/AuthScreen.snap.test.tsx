/**
 * AuthScreen — snapshots for the SUSI flow's branching states.
 *
 * The screen has five logical phases (oauth-wait → org → workspace →
 * project → key entry). Each branch is gated on session.pendingOrgs +
 * counts. Snapshotting the rendered text catches regressions in:
 *
 *   - The "Waiting for authentication" copy + login URL fallback
 *   - The org / workspace / project picker headings
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
        { id: 'org-1', name: 'Acme Corp', workspaces: [] },
        { id: 'org-2', name: 'Globex', workspaces: [] },
      ],
    });
    const { frame } = renderSnapshot(<AuthScreen store={store} />, store);
    expect(frame).toContain('Select your organization');
    expect(frame).toContain('Acme Corp');
    expect(frame).toContain('Globex');
  });

  it('renders the workspace picker with Create + Start over actions when multi-org', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      pendingOrgs: [
        // Two orgs → Start over option appears
        {
          id: 'org-1',
          name: 'Acme Corp',
          workspaces: [
            { id: 'ws-1', name: 'Production' },
            { id: 'ws-2', name: 'Staging' },
          ],
        },
        { id: 'org-2', name: 'Globex', workspaces: [] },
      ],
      selectedOrgId: 'org-1',
      selectedOrgName: 'Acme Corp',
    });
    const { frame } = renderSnapshot(<AuthScreen store={store} />, store);
    expect(frame).toContain('Select a workspace');
    expect(frame).toContain('Production');
    expect(frame).toContain('Staging');
    expect(frame).toContain('Create new project');
    expect(frame).toContain('Start over');
  });

  it('omits Start over from the workspace picker when only one org is available', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      pendingOrgs: [
        {
          id: 'org-1',
          name: 'Solo Org',
          workspaces: [
            { id: 'ws-1', name: 'Workspace A' },
            { id: 'ws-2', name: 'Workspace B' },
          ],
        },
      ],
    });
    const { frame } = renderSnapshot(<AuthScreen store={store} />, store);
    // Auto-selected single org → workspace picker is shown without Start over
    expect(frame).toContain('Select a workspace');
    expect(frame).toContain('Workspace A');
    expect(frame).toContain('Create new project');
    expect(frame).not.toContain('Start over');
  });

  it('renders the project (environment) picker when the workspace has multiple env keys', () => {
    // No installDir / ID prepopulation needed: the snapshot util points
    // installDir at a tmp dir, and the auto-resolve effect skips the
    // ampli.json write when session IDs already match the resolved
    // org/workspace. Either way no stray ampli.json appears at the
    // repo root during tests.
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      pendingOrgs: [
        {
          id: 'org-1',
          name: 'Acme',
          workspaces: [
            {
              id: 'ws-1',
              name: 'Solo Workspace',
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
    expect(frame).toContain('Select a project');
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
        { id: 'org-1', name: 'Acme', workspaces: [] },
        { id: 'org-2', name: 'Globex', workspaces: [] },
      ],
    });
    const { frame } = renderSnapshot(<AuthScreen store={store} />, store);
    expect(frame).toContain('Framework: Next.js');
    expect(frame).toContain('Select your organization');
  });
});
