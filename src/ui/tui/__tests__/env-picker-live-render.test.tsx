/**
 * INTEGRATION test — live render of the frozen-after-reset scenario.
 *
 * Unlike the existing unit tests, this one renders the full App component
 * via ink-testing-library and asserts what the user actually sees on
 * screen — the env picker — when post-deferral state is in place.
 *
 * This is the test the 8th-fix-attempt brief asked for: drive the wizard
 * past the deferral, let AuthScreen's effects fire naturally, and check
 * that the frame contains the env picker rather than a Setup-bucket
 * screen. The 7 prior fixes passed mocked unit tests; this test fails
 * IF the React effect chain inside AuthScreen drives the router past
 * Auth without rendering the picker.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { createElement } from 'react';

vi.mock('../../../utils/ampli-settings.js', () => ({
  getStoredUser: vi.fn(() => undefined),
  getStoredToken: vi.fn(() => undefined),
}));
vi.mock('../../../lib/ampli-config.js', () => ({
  readAmpliConfig: vi.fn(() => ({ ok: false, error: 'not_found' })),
  ampliConfigExists: vi.fn(() => false),
  writeAmpliConfig: vi.fn(),
  AMPLI_CONFIG_FILENAME: 'ampli.json',
}));
vi.mock('../../../utils/api-key-store.js', () => ({
  readApiKeyWithSource: vi.fn(() => null),
  readApiKey: vi.fn(() => null),
  persistApiKey: vi.fn(() => 'cache'),
  clearApiKey: vi.fn(),
}));

import { WizardStore, Flow } from '../store.js';
import { Screen } from '../flows.js';
import { App } from '../App.js';
import { buildSession } from '../../../lib/wizard-session.js';

function multiEnvPendingOrgs() {
  return [
    {
      id: 'org-1',
      name: 'Acme',
      projects: [
        {
          id: 'proj-1',
          name: 'Demo',
          environments: [
            { name: 'Development', rank: 1, app: { id: 'app-1', apiKey: 'k1' } },
            { name: 'Production', rank: 2, app: { id: 'app-2', apiKey: 'k2' } },
          ],
        },
      ],
    },
  ];
}

const waitForFrame = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('env-picker live render — frozen-after-reset', () => {
  it('renders the env picker (not Setup) when post-deferral state lands', async () => {
    const session = buildSession({ installDir: '/tmp/frozen-live-test' });
    session.region = 'us';
    session.introConcluded = true;
    session.pendingOrgs = multiEnvPendingOrgs();
    session.pendingAuthIdToken = 'id-token';
    session.pendingAuthAccessToken = 'access-token';
    // applyEnvSelectionDeferral wipes these:
    session.selectedEnvName = null;
    session.selectedAppId = null;
    session.credentials = null;
    session.pendingEnvSelection = true;

    const store = new WizardStore(Flow.Wizard);
    store.session = session;

    // Pre-mount sanity: router is on Auth.
    expect(store.currentScreen).toBe(Screen.Auth);

    const view = render(createElement(App, { store }));
    // Let effects fire (auto-resolve single-org/project, env auto-select,
    // credential-loading effect, etc.). 200ms is generous.
    await waitForFrame();
    await waitForFrame();
    await new Promise((r) => setTimeout(r, 50));
    await waitForFrame();

    const frame = view.lastFrame() ?? '';
    view.unmount();

    // CRITICAL ASSERTIONS — the user must see the env picker.
    expect(store.currentScreen).toBe(Screen.Auth);
    expect(store.session.pendingEnvSelection).toBe(true);
    expect(store.session.credentials).toBeNull();
    expect(store.session.selectedEnvName).toBeNull();
    // The picker shows env names — "Development" or "Production" should be
    // rendered.
    expect(frame).toMatch(/Development|Production/);
  });

  it('renders the env picker after authTask fires setOAuthComplete (same orgs)', async () => {
    const session = buildSession({ installDir: '/tmp/frozen-live-test-2' });
    session.region = 'us';
    session.introConcluded = true;
    session.pendingOrgs = multiEnvPendingOrgs();
    session.pendingAuthIdToken = 'id-token';
    session.pendingAuthAccessToken = 'access-token';
    session.selectedEnvName = null;
    session.selectedAppId = null;
    session.credentials = null;
    session.pendingEnvSelection = true;

    const store = new WizardStore(Flow.Wizard);
    store.session = session;

    const view = render(createElement(App, { store }));
    await waitForFrame();
    await waitForFrame();
    await new Promise((r) => setTimeout(r, 50));

    // Simulate authTask landing fresh OAuth completion mid-render.
    store.setOAuthComplete({
      accessToken: 'fresh-access',
      idToken: 'fresh-id',
      cloudRegion: 'us',
      orgs: multiEnvPendingOrgs(),
    });
    await waitForFrame();
    await new Promise((r) => setTimeout(r, 50));
    await waitForFrame();

    const frame = view.lastFrame() ?? '';
    view.unmount();

    expect(store.currentScreen).toBe(Screen.Auth);
    expect(store.session.pendingEnvSelection).toBe(true);
    expect(store.session.credentials).toBeNull();
    expect(frame).toMatch(/Development|Production/);
  });

  // ── THE BUG ────────────────────────────────────────────────────────
  //
  // The resolver saw 2 envs WITH keys and deferred (pendingEnvSelection=true).
  // The authTask's setOAuthComplete fires with fresh pendingOrgs where ONE
  // env's app.apiKey has come back null (an env was just provisioned, a
  // key was rotated, the user's role changed between the two fetches —
  // many production race conditions land here). selectableEnvs now has
  // length=1.
  //
  // AuthScreen's effect at line 220 auto-selects the only env with a key.
  // The next effect at line 238 then takes the "selected env has apiKey"
  // path and calls setCredentials + setPendingEnvSelection(false). The
  // env picker NEVER renders — the router walks past Auth into the
  // Setup-bucket screens, producing the user-reported
  // "✓ Welcome ─ ✓ Auth ─ ● Setup" hang with no picker on screen.
  //
  // The fix: when the resolver explicitly deferred (pendingEnvSelection=true),
  // AuthScreen must NOT silently auto-select a single available env. The
  // user gets to choose — including when one of the envs lost its key
  // between the resolver's fetch and authTask's fetch.
  //
  // This test FAILS without the fix (router lands on a Setup-bucket
  // screen) and PASSES with it (router stays on Auth, picker renders).
  it('does NOT silently auto-resolve when resolver deferred — even if fresh fetch has only one env-with-key', async () => {
    const session = buildSession({ installDir: '/tmp/frozen-live-test-defer-asymmetry' });
    session.region = 'us';
    session.introConcluded = true;
    // FIRST pendingOrgs (from resolveCredentials) — 2 envs WITH keys.
    session.pendingOrgs = multiEnvPendingOrgs();
    session.pendingAuthIdToken = 'id-token';
    session.pendingAuthAccessToken = 'access-token';
    session.selectedEnvName = null;
    session.selectedAppId = null;
    session.credentials = null;
    session.pendingEnvSelection = true;

    const store = new WizardStore(Flow.Wizard);
    store.session = session;

    const view = render(createElement(App, { store }));
    await waitForFrame();
    await new Promise((r) => setTimeout(r, 50));

    // Now authTask's setOAuthComplete fires. SECOND fetch returns the
    // SAME shape but Development's app.apiKey is now null (provisioning
    // race / role change / etc.).
    store.setOAuthComplete({
      accessToken: 'fresh-access',
      idToken: 'fresh-id',
      cloudRegion: 'us',
      orgs: [
        {
          id: 'org-1',
          name: 'Acme',
          projects: [
            {
              id: 'proj-1',
              name: 'Demo',
              environments: [
                {
                  name: 'Development',
                  rank: 1,
                  app: { id: 'app-1', apiKey: null },
                },
                {
                  name: 'Production',
                  rank: 2,
                  app: { id: 'app-2', apiKey: 'k2' },
                },
              ],
            },
          ],
        },
      ],
    });
    await waitForFrame();
    await new Promise((r) => setTimeout(r, 100));
    await waitForFrame();
    await new Promise((r) => setTimeout(r, 100));
    await waitForFrame();

    const frame = view.lastFrame() ?? '';
    view.unmount();

    // CRITICAL: the router MUST still be on Auth and the deferral flag
    // MUST still be set. The fix prevents AuthScreen from silently
    // resolving credentials when the resolver said the user must choose.
    expect(store.currentScreen).toBe(Screen.Auth);
    expect(store.session.pendingEnvSelection).toBe(true);
    // The env picker (or some form of explicit user-actionable surface)
    // must be visible — never a blank/post-Auth screen.
    expect(frame.length).toBeGreaterThan(0);
  });

  it('renders the env picker after a STALE id auto-resolve (PR #797 scenario)', async () => {
    const session = buildSession({ installDir: '/tmp/frozen-live-test-3' });
    session.region = 'us';
    session.introConcluded = true;
    // First pendingOrgs from resolveCredentials with DIFFERENT IDs.
    session.pendingOrgs = [
      {
        id: 'org-stale',
        name: 'StaleOrg',
        projects: [
          {
            id: 'proj-stale',
            name: 'StaleProject',
            environments: [
              { name: 'Dev', rank: 1, app: { id: 'stale-1', apiKey: 'sk1' } },
              { name: 'Prod', rank: 2, app: { id: 'stale-2', apiKey: 'sk2' } },
            ],
          },
        ],
      },
    ];
    session.pendingAuthIdToken = 'id-token';
    session.pendingAuthAccessToken = 'access-token';
    // Auth screen wrote these from the initial pendingOrgs:
    session.selectedOrgId = 'org-stale';
    session.selectedOrgName = 'StaleOrg';
    session.selectedProjectId = 'proj-stale';
    session.selectedProjectName = 'StaleProject';
    session.selectedAppId = 'stale-1';
    session.selectedEnvName = null;
    session.credentials = null;
    session.pendingEnvSelection = true;

    const store = new WizardStore(Flow.Wizard);
    store.session = session;

    const view = render(createElement(App, { store }));
    await waitForFrame();
    await new Promise((r) => setTimeout(r, 50));

    // Now authTask fires setOAuthComplete with FRESH (different) data.
    store.setOAuthComplete({
      accessToken: 'fresh-access',
      idToken: 'fresh-id',
      cloudRegion: 'us',
      orgs: multiEnvPendingOrgs(), // NEW IDs (org-1/proj-1)
    });
    await waitForFrame();
    await new Promise((r) => setTimeout(r, 50));
    await waitForFrame();

    const frame = view.lastFrame() ?? '';
    view.unmount();

    expect(store.currentScreen).toBe(Screen.Auth);
    expect(store.session.pendingEnvSelection).toBe(true);
    expect(frame).toMatch(/Development|Production/);
  });
});
