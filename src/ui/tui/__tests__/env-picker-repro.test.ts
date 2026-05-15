/**
 * Regression coverage for the recurring "stuck on Setup with no env-picker"
 * bug — three prior PRs (#747, #760, #762) each claimed to close it; user
 * reports kept reproducing. The original `pendingEnvSelection` flag is
 * the primary gate, but it was getting clobbered through paths that
 * weren't fully understood at the time of the fix.
 *
 * This test pins the **structural defense-in-depth gate** added to
 * `Auth.isComplete` (flows.ts): "if pendingOrgs is populated AND a project
 * is selected AND that project has ≥ 2 envs with API keys AND the user
 * hasn't picked one yet, Auth.isComplete returns false". That predicate
 * doesn't depend on `pendingEnvSelection` — it reads structural session
 * state directly — so it survives whatever bug was flipping the flag.
 *
 * If a future change clobbers `pendingEnvSelection` (intentionally or
 * accidentally), these tests still pass and the router still parks the
 * user on Auth until they pick an env.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../utils/ampli-settings.js', () => ({
  getStoredUser: vi.fn(() => undefined),
  getStoredToken: vi.fn(() => undefined),
}));
vi.mock('../../../lib/ampli-config.js', () => ({
  readAmpliConfig: vi.fn(() => ({ ok: false, error: 'not_found' })),
  ampliConfigExists: vi.fn(() => false),
}));

import { WizardStore, Flow, Screen } from '../store.js';
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
            { name: 'Production', rank: 1, app: { id: 'app-1', apiKey: 'k1' } },
            { name: 'Staging', rank: 2, app: { id: 'app-2', apiKey: 'k2' } },
            { name: 'Dev', rank: 3, app: { id: 'app-3', apiKey: 'k3' } },
            { name: 'Test', rank: 4, app: { id: 'app-4', apiKey: 'k4' } },
          ],
        },
      ],
    },
  ];
}

function mockCredentials() {
  return {
    accessToken: 'test-access-token',
    idToken: 'test-id-token',
    projectApiKey: 'test-api-key',
    host: 'https://api.amplitude.com',
    appId: 12345,
  };
}

describe('env-picker hang — structural fallback gate on Auth.isComplete', () => {
  it('router parks on Auth when pendingOrgs has a multi-env project AND selectedEnvName is null — EVEN IF pendingEnvSelection somehow got cleared', () => {
    const session = buildSession({ installDir: '/tmp/fake' });
    const store = new WizardStore(Flow.Wizard);
    store.session = session;

    // Simulate the exact post-deferral state EXCEPT the pendingEnvSelection
    // flag — flip it to FALSE to model the bug we're defending against
    // (the recurring "flag got clobbered" failure mode).
    session.introConcluded = true;
    session.region = 'us';
    session.selectedOrgId = 'org-1';
    session.selectedOrgName = 'Acme';
    session.selectedProjectId = 'proj-1';
    session.selectedProjectName = 'Demo';
    session.selectedEnvName = null;
    session.selectedAppId = null;
    // Credentials are non-null — this is what tripped Auth.isComplete in
    // the original bug (a stored API key or checkpoint rehydration left
    // them populated even after the resolver said `needs_user_choice`).
    session.credentials = mockCredentials();
    session.pendingOrgs = multiEnvPendingOrgs();
    // **THE KEY ASSERTION**: pendingEnvSelection is FALSE here. Whatever
    // path clobbered it (the bug surface), the router MUST still park on
    // Auth because the structural state — "the resolved project has
    // multiple envs and no env is picked" — clearly says the env picker
    // hasn't run yet.
    session.pendingEnvSelection = false;
    session.requiresAccountConfirmation = false;

    store.session = session;

    expect(store.currentScreen).toBe(Screen.Auth);
    expect(store.currentScreen).not.toBe(Screen.Setup);
    expect(store.currentScreen).not.toBe(Screen.Run);
    expect(store.currentScreen).not.toBe(Screen.Mcp);
    expect(store.currentScreen).not.toBe(Screen.ActivationOptions);
    expect(store.currentScreen).not.toBe(Screen.DataSetup);
  });

  it('clears the structural block once the user picks an env (selectedEnvName set)', () => {
    const session = buildSession({ installDir: '/tmp/fake' });
    const store = new WizardStore(Flow.Wizard);
    store.session = session;

    session.introConcluded = true;
    session.region = 'us';
    session.selectedOrgId = 'org-1';
    session.selectedOrgName = 'Acme';
    session.selectedProjectId = 'proj-1';
    session.selectedProjectName = 'Demo';
    session.selectedEnvName = null;
    session.credentials = mockCredentials();
    session.pendingOrgs = multiEnvPendingOrgs();
    session.pendingEnvSelection = false;

    expect(store.currentScreen).toBe(Screen.Auth);

    // User picks an env on AuthScreen — setCredentials lands a new env-pinned
    // credentials object, then setSelectedEnvName fires.
    session.selectedEnvName = 'Production';
    session.selectedAppId = 'app-1';

    // With the env picked, Auth.isComplete returns true and the router
    // advances. DataSetup is the next non-skipped entry (projectHasData is
    // still null, so it hasn't completed either).
    expect(store.currentScreen).toBe(Screen.DataSetup);
  });

  it('does not block the manual-API-key path (pendingOrgs === null)', () => {
    // When the user enters an API key manually, the resolver lands at
    // `api_key_notice` (or similar non-needs_user_choice outcomes) and
    // `pendingOrgs` is null. setCredentials fires WITHOUT touching
    // selectedEnvName. The structural gate must not block that path —
    // it should pass through to DataSetup like before the fix.
    const session = buildSession({ installDir: '/tmp/fake' });
    const store = new WizardStore(Flow.Wizard);
    store.session = session;

    session.introConcluded = true;
    session.region = 'us';
    session.selectedOrgId = 'org-manual';
    session.selectedOrgName = 'Acme';
    session.selectedProjectId = 'proj-manual';
    session.selectedProjectName = 'Demo';
    // No selectedEnvName — manual API key entry can't always determine
    // the env from the key.
    session.selectedEnvName = null;
    session.credentials = mockCredentials();
    // pendingOrgs is null — this is the structural signature of the
    // manual path.
    session.pendingOrgs = null;
    session.pendingEnvSelection = false;

    // The manual-key path advances past Auth normally.
    expect(store.currentScreen).toBe(Screen.DataSetup);
  });

  it('does not block when pendingOrgs has a single-env project (no picker needed)', () => {
    const session = buildSession({ installDir: '/tmp/fake' });
    const store = new WizardStore(Flow.Wizard);
    store.session = session;

    session.introConcluded = true;
    session.region = 'us';
    session.selectedOrgId = 'org-1';
    session.selectedOrgName = 'Acme';
    session.selectedProjectId = 'proj-1';
    session.selectedProjectName = 'Demo';
    session.selectedEnvName = null;
    session.credentials = mockCredentials();
    // Single-env project — no picker needed.
    session.pendingOrgs = [
      {
        id: 'org-1',
        name: 'Acme',
        projects: [
          {
            id: 'proj-1',
            name: 'Demo',
            environments: [
              {
                name: 'Production',
                rank: 1,
                app: { id: 'app-1', apiKey: 'k1' },
              },
            ],
          },
        ],
      },
    ];
    session.pendingEnvSelection = false;

    // Single-env: the structural gate doesn't fire (< 2 envs), Auth
    // advances normally.
    expect(store.currentScreen).toBe(Screen.DataSetup);
  });

  it('parks on Auth when the resolved project is missing from pendingOrgs (stale IDs)', () => {
    // The live restart-after-reset bug surfaced through this exact path:
    // AuthScreen's auto-resolve effect writes `selectedOrgId/ProjectId`
    // from the FIRST `pendingOrgs` snapshot (returned by
    // `resolveCredentials`); the `authTask` then runs OAuth and
    // `setOAuthComplete` REPLACES `pendingOrgs` with a fresh fetch.
    // If the two snapshots' IDs don't match (re-fetch race, ordering
    // difference, account changes between calls, stale session memory),
    // the structural gate's first lookup misses — and pre-fix that
    // bailed out to `false`, letting Auth.isComplete return true and
    // the router advance past Auth → Setup with NO env picker on
    // screen. The fix falls through to `pendingOrgs[0].projects[0]`
    // (the same heuristic resolveCredentials used when it issued the
    // deferral), keeping the user on Auth until they pick an env.
    const session = buildSession({ installDir: '/tmp/fake' });
    const store = new WizardStore(Flow.Wizard);
    store.session = session;

    session.introConcluded = true;
    session.region = 'us';
    session.selectedOrgId = 'org-1';
    session.selectedOrgName = 'Acme';
    session.selectedProjectId = 'stale-proj'; // not in pendingOrgs below
    session.selectedProjectName = 'Stale';
    session.selectedEnvName = null;
    session.credentials = mockCredentials();
    session.pendingOrgs = multiEnvPendingOrgs(); // org-1/proj-1, not stale-proj
    session.pendingEnvSelection = false;

    // Post-fix: the gate falls through to `pendingOrgs[0].projects[0]`
    // (the multi-env project), returns `true`, Auth.isComplete returns
    // `false`, router parks on Auth. AuthScreen's stale-org useEffect
    // will clear selectedOrgId on the next render, so the user sees
    // the picker normally — but the critical guarantee is the router
    // doesn't walk past Auth into the Setup-bucket screens with no
    // picker surface.
    expect(store.currentScreen).toBe(Screen.Auth);
  });

  it('still works in conjunction with pendingEnvSelection=true (both gates active)', () => {
    const session = buildSession({ installDir: '/tmp/fake' });
    const store = new WizardStore(Flow.Wizard);
    store.session = session;

    session.introConcluded = true;
    session.region = 'us';
    session.selectedOrgId = 'org-1';
    session.selectedOrgName = 'Acme';
    session.selectedProjectId = 'proj-1';
    session.selectedProjectName = 'Demo';
    session.selectedEnvName = null;
    session.credentials = null; // matches normal deferral
    session.pendingOrgs = multiEnvPendingOrgs();
    session.pendingEnvSelection = true; // primary gate also engaged

    expect(store.currentScreen).toBe(Screen.Auth);
  });
});
