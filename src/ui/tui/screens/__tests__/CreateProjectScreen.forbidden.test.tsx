/**
 * CreateProjectScreen — FORBIDDEN admin-handoff regression test.
 *
 * Hard rule: this screen must NEVER be a dead-end. When the backend returns
 * FORBIDDEN we must (a) name the org the user was trying to create in, and
 * (b) offer a way out via [O]pen Amplitude in addition to [Esc] back. This
 * test mocks `createAmplitudeApp` to throw FORBIDDEN, drives a submit, and
 * asserts the rendered frame includes the org name AND the open-in-browser
 * affordance.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { ApiError } from '../../../../lib/api.js';

// vi.mock must be hoisted; reference the function via a module-level mock.
vi.mock('../../../../lib/api.js', async (importActual) => {
  const actual = await importActual<typeof import('../../../../lib/api.js')>();
  return {
    ...actual,
    createAmplitudeApp: vi.fn(),
    fetchAmplitudeUser: vi.fn().mockResolvedValue({
      id: 'u1',
      firstName: 'A',
      lastName: 'B',
      email: 'a@b.c',
      orgs: [],
    }),
  };
});

describe('CreateProjectScreen FORBIDDEN', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders org name + Open Amplitude link instead of dead-ending', async () => {
    const api = await import('../../../../lib/api.js');
    (api.createAmplitudeApp as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError('Forbidden', 403, '/projects', 'FORBIDDEN'),
    );

    const { CreateProjectScreen } = await import('../CreateProjectScreen.js');
    const { makeStoreForSnapshot } = await import(
      '../../__tests__/snapshot-utils.js'
    );

    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      selectedOrgId: 'org-7',
      selectedOrgName: 'Acme Corp',
      // Auto-submit path: agent/CI true + suggestedName set → mounts and
      // immediately calls handleSubmit, which lets us reach the FORBIDDEN
      // branch without driving stdin keystrokes.
      agent: true,
      createProject: {
        pending: true,
        source: 'slash',
        suggestedName: 'My Project',
      },
      pendingAuthAccessToken: 'tok',
      pendingAuthIdToken: 'id',
    });

    const { lastFrame, unmount } = render(
      <CreateProjectScreen store={store} />,
    );
    // Wait for the rejected promise to resolve through React state.
    await new Promise((r) => setTimeout(r, 50));

    // eslint-disable-next-line no-control-regex
    const csi = /\x1b\[[0-9;]*[A-Za-z]/g;
    // eslint-disable-next-line no-control-regex
    const osc = /\x1b\][^\x07]*\x07/g;
    const frame = (lastFrame() ?? '').replace(csi, '').replace(osc, '');

    // Org name is named in the copy (regression: previously "this org").
    expect(frame).toContain('Acme Corp');
    // Admin handoff guidance.
    expect(frame).toMatch(/admin/i);
    // Open-in-browser affordance — links and key hint both present.
    expect(frame).toContain('Open Amplitude');
    expect(frame).toMatch(/Press O to open/);
    // Esc still works — back to picker.
    expect(frame).toMatch(/Esc to go back/i);

    unmount();
  });
});
