/**
 * Regression — env picker hang after `git reset --hard` of a previously
 * instrumented project.
 *
 * Repro:
 *   1. wizard completes a full run; writes
 *      `~/excalidraw/.amplitude/{events,dashboard,project-binding}.json`
 *      plus `~/.amplitude/wizard/runs/<hash>/checkpoint.json`.
 *   2. user runs `git reset --hard` (or `rm -rf .amplitude/`) which wipes the
 *      per-project `.amplitude/` directory.
 *   3. user re-runs the wizard.
 *
 * Expected: wizard routes to AuthScreen and renders the env picker (the
 * user must pick which environment to instrument against).
 *
 * Actual (the bug 6 prior PRs failed to fix): the journey stepper shows
 * `✓ Welcome ─ ✓ Auth ─ ● Setup ←` with no env picker on screen.
 *
 * This test simulates the entire bin.ts startup sequence — including the
 * authTask `setOAuthComplete` call that fires after `applyEnvSelectionDeferral`
 * — and asserts the router parks on Auth at every step.
 *
 * THE LOAD-BEARING TEST IS THE LAST ONE — `pendingEnvSelection clobbered +
 * stale selectedOrgId/ProjectId pre-fix this fails because the
 * structural gate (`needsEnvPickStillRequired`) short-circuits to `false`
 * when the IDs don't match anything in pendingOrgs.
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
            {
              name: 'Development',
              rank: 1,
              app: { id: 'app-1', apiKey: 'k1' },
            },
            { name: 'Production', rank: 2, app: { id: 'app-2', apiKey: 'k2' } },
          ],
        },
      ],
    },
  ];
}

function mockCredentials() {
  return {
    accessToken: 'access',
    idToken: 'id',
    projectApiKey: 'k1',
    host: 'https://api.amplitude.com',
    appId: 12345,
  };
}

describe('env-picker restart-after-reset hang — full bin.ts sequence', () => {
  it('router parks on Auth through the full bin.ts setup chain', () => {
    // ── Step 1: buildSessionFromOptions ────────────────────────────
    const session = buildSession({ installDir: '/tmp/excalidraw-fake' });

    // ── Step 2: startTUI(session) — store.session = session ────────
    const store = new WizardStore(Flow.Wizard);
    store.session = session;
    expect(store.currentScreen).toBe(Screen.Intro);

    // ── Step 3: selfHealIfNeeded clears checkpoint + API key (real
    //           filesystem side effects, but no session mutation). ──
    // (no-op from the session's POV)

    // ── Step 4: loadCheckpoint returns null (file deleted). ────────
    // No Object.assign of checkpoint fields.

    // ── Step 5: resolveCredentials runs. Storage check finds nothing
    //           (no local key after self-heal). fetchAmplitudeUser
    //           returns orgs. Multi-env branch fires: pendingOrgs +
    //           pendingAuthIdToken + pendingAuthAccessToken set, but
    //           NO selectedOrgId/Name/ProjectId/Name (those only get
    //           set when ampli.json had IDs — wiped here). ──────────
    session.pendingOrgs = multiEnvPendingOrgs();
    session.pendingAuthIdToken = 'id-token';
    session.pendingAuthAccessToken = 'access-token';
    session.region = 'us'; // resolveZone derives from stored user

    // ── Step 6: applyEnvSelectionDeferral ──────────────────────────
    session.selectedEnvName = null;
    session.selectedAppId = null;
    session.credentials = null;
    session.pendingEnvSelection = true;

    // ── Step 7: tui.store.session = session — re-emit ──────────────
    store.session = session;

    // ── Step 8: User dismisses IntroScreen ─────────────────────────
    store.concludeIntro();

    // SANITY: at this point the router MUST be on Auth.
    expect(store.currentScreen).toBe(Screen.Auth);

    // ── Step 9: authTask fires — performAmplitudeAuth reuses the
    //           cached token, fetchAmplitudeUser succeeds, and
    //           setOAuthComplete is called with the fresh orgs. This
    //           is where the bug landed: setOAuthComplete REPLACES
    //           pendingOrgs but does NOT touch pendingEnvSelection. If
    //           any downstream side-effect re-fires the multi-env
    //           defer path, the structural gate has to keep us on
    //           Auth. ────────────────────────────────────────────
    store.setOAuthComplete({
      accessToken: 'access-token-fresh',
      idToken: 'id-token-fresh',
      cloudRegion: 'us',
      orgs: multiEnvPendingOrgs(),
    });

    // POST-setOAuthComplete: router MUST still be on Auth (env picker
    // surface) — not Setup, not Run, not DataSetup.
    expect(store.currentScreen).toBe(Screen.Auth);
    expect(store.session.pendingEnvSelection).toBe(true);
    expect(store.session.credentials).toBeNull();

    // ── Step 10: AuthScreen's auto-resolve effect for single-org
    //            single-project: calls setOrgAndProject. This populates
    //            selectedOrgId/Name/ProjectId/Name + selectedAppId
    //            (from the lowest-rank env). It does NOT touch
    //            selectedEnvName or pendingEnvSelection. ────────────
    const org = store.session.pendingOrgs![0];
    const project = org.projects[0];
    store.setOrgAndProject(org, project, store.session.installDir, {
      persist: false,
    });

    // POST-setOrgAndProject: router MUST still be on Auth. The
    // structural gate (`needsEnvPickStillRequired`) sees:
    //   - pendingOrgs populated
    //   - selectedEnvName === null
    //   - resolved project has 2 envs with API keys
    // → returns true → Auth.isComplete returns false → router parks.
    //
    // ALSO: `pendingEnvSelection` is still true, which is itself the
    // primary gate. So both gates should pin Auth.
    expect(store.currentScreen).toBe(Screen.Auth);
    expect(store.session.pendingEnvSelection).toBe(true);
    expect(store.session.selectedEnvName).toBeNull();
  });

  // THE FAILING TEST (pre-fix): the structural gate
  // `needsEnvPickStillRequired` short-circuits to `false` when
  // `selectedOrgId` / `selectedProjectId` are set BUT they don't match
  // anything in the freshly-replaced `pendingOrgs`. This happens in the
  // real repro because:
  //
  //   1. `resolveCredentials` populates `pendingOrgs` (initial data) and
  //      defers on multi-env.
  //   2. `applyEnvSelectionDeferral` sets `pendingEnvSelection=true`.
  //   3. AuthScreen mounts, auto-resolves single-org/single-project,
  //      writes `selectedOrgId='org-1'`, `selectedProjectId='proj-1'`.
  //   4. authTask fires `setOAuthComplete` which REPLACES pendingOrgs
  //      with fresh data from a second `fetchAmplitudeUser` call. The
  //      fresh data may have different IDs (orderings, accounts changed,
  //      account switched, even just a re-fetch race), leaving the
  //      `selectedOrgId/ProjectId` written in step 3 pointing at a
  //      project NOT IN the fresh `pendingOrgs`.
  //   5. If anything clobbers `pendingEnvSelection=false` (the 6-PRs
  //      worth of recurring bug class), the structural gate is the only
  //      defense. But the structural gate looks up `selectedOrgId` in
  //      `pendingOrgs` and bails out with `false` because the IDs are
  //      stale → Auth.isComplete returns true → router advances to
  //      Setup → env picker never renders. User-visible: stepper shows
  //      `● Setup ←` with no picker on screen.
  //
  // The fix: when stale IDs don't resolve a project in `pendingOrgs`,
  // FALL THROUGH to the `pendingOrgs[0].projects[0]` heuristic (the
  // same one PR #780 added for the no-IDs path) instead of bailing out
  // to `false`. This keeps the gate load-bearing across all of:
  //   - no IDs picked yet (PR #780)
  //   - IDs picked AND valid in pendingOrgs (the existing happy path)
  //   - IDs picked but STALE relative to pendingOrgs (this PR)
  it('parks on Auth when selectedOrgId/ProjectId are STALE relative to fresh pendingOrgs', () => {
    const session = buildSession({ installDir: '/tmp/fake' });
    const store = new WizardStore(Flow.Wizard);
    store.session = session;

    session.introConcluded = true;
    session.region = 'us';
    // AuthScreen wrote these from the FIRST `pendingOrgs` snapshot
    // (resolveCredentials defer branch). Now they're stale.
    session.selectedOrgId = 'org-stale';
    session.selectedOrgName = 'Stale Org';
    session.selectedProjectId = 'proj-stale';
    session.selectedProjectName = 'Stale Project';
    session.selectedEnvName = null;
    session.credentials = mockCredentials();
    // Fresh `pendingOrgs` from `setOAuthComplete` — different IDs.
    session.pendingOrgs = multiEnvPendingOrgs();
    // Simulate the recurring bug: `pendingEnvSelection` somehow got
    // clobbered back to `false` after the deferral. The 6-PR history
    // makes it clear this state IS reachable in production.
    session.pendingEnvSelection = false;
    session.requiresAccountConfirmation = false;

    store.session = session;

    // EXPECTATION: the router must park on Auth. The structural gate's
    // job is to detect "the freshly-fetched pendingOrgs has a multi-env
    // project AND the user hasn't picked an env" — regardless of
    // whether selectedOrgId/ProjectId happen to be stale.
    //
    // PRE-FIX (the bug): `needsEnvPickStillRequired` short-circuits to
    // `false` because `pendingOrgs.find(o => o.id === 'org-stale')`
    // returns `undefined`. Auth.isComplete then returns true and the
    // router walks past Auth → Setup. User sees the hang.
    //
    // POST-FIX: the gate falls through to `pendingOrgs[0].projects[0]`
    // (the same heuristic resolveCredentials used when it issued the
    // deferral) and sees the multi-env project. Returns `true` →
    // Auth.isComplete returns `false` → router parks on Auth.
    expect(store.currentScreen).toBe(Screen.Auth);
    expect(store.currentScreen).not.toBe(Screen.Setup);
    expect(store.currentScreen).not.toBe(Screen.Run);
    expect(store.currentScreen).not.toBe(Screen.DataSetup);
  });
});
