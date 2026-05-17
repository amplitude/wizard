/**
 * JourneyStepper — the persistent 1-line progress bar across the wizard.
 *
 * Verifies that the right step lights up for each session position and
 * that the stepper hides itself outside the main Wizard flow (e.g. the
 * /mcp slash command opens the McpAdd flow which has no journey).
 *
 * Layout regressions to guard against:
 *   - Active step missing the "←" cursor when labels are visible
 *   - Stepper rendered for sub-flows (would mislead users on /mcp etc.)
 *   - All-future steps when session state advances but currentScreen lags
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { JourneyStepper } from '../JourneyStepper.js';
import { WizardStore, Flow, RunPhase } from '../../store.js';
import type { WizardSession } from '../../store.js';
import { OutroKind } from '../../session-constants.js';
import { frameOf } from '../../__tests__/helpers/render-frame.js';

function makeStore(patch: Partial<WizardSession> = {}, flow = Flow.Wizard) {
  const store = new WizardStore(flow);
  if (Object.keys(patch).length > 0) {
    store.session = { ...store.session, ...patch };
  }
  return store;
}

const CREDS = {
  accessToken: 'tok',
  projectApiKey: 'pk',
  host: 'https://app.amplitude.com',
  appId: 1,
};

describe('JourneyStepper', () => {
  it('shows all five labelled steps on a wide terminal', () => {
    const store = makeStore();
    const out = frameOf(<JourneyStepper store={store} width={120} />);
    expect(out).toContain('Welcome');
    expect(out).toContain('Auth');
    expect(out).toContain('Setup');
    expect(out).toContain('Verify');
    expect(out).toContain('Done');
  });

  it('hides labels but still draws bullets on a narrow terminal', () => {
    const store = makeStore();
    const out = frameOf(<JourneyStepper store={store} width={40} />);
    expect(out).not.toContain('Welcome');
    expect(out).not.toContain('Verify');
    // Active bullet present
    expect(out).toContain('●');
  });

  it('marks the active step with the ← cursor on the fresh-session intro', () => {
    const store = makeStore();
    const out = frameOf(<JourneyStepper store={store} width={120} />);
    expect(out).toContain('Welcome ←');
  });

  it('moves the active cursor to Auth once intro is concluded', () => {
    // After concludeIntro, the router lands on RegionSelect — which belongs
    // to the Auth step bucket per STEP_SCREENS in JourneyStepper.tsx.
    const store = makeStore({ introConcluded: true });
    const out = frameOf(<JourneyStepper store={store} width={120} />);
    expect(out).toContain('Auth ←');
    expect(out).not.toContain('Welcome ←');
  });

  it('moves to Verify once the agent run completes and MCP is done', () => {
    const store = makeStore({
      introConcluded: true,
      region: 'us',
      credentials: CREDS,
      selectedOrgName: 'Acme',
      selectedProjectName: 'Amplitude',
      selectedEnvName: 'Production',
      projectHasData: false,
      activationLevel: 'none',
      runPhase: RunPhase.Completed,
      mcpComplete: true,
    });
    const out = frameOf(<JourneyStepper store={store} width={120} />);
    expect(out).toContain('Verify ←');
  });

  it('lands on Done when slack is the final step and complete', () => {
    const store = makeStore({
      introConcluded: true,
      region: 'us',
      credentials: CREDS,
      selectedOrgName: 'Acme',
      selectedProjectName: 'Amplitude',
      selectedEnvName: 'Production',
      projectHasData: false,
      activationLevel: 'none',
      runPhase: RunPhase.Completed,
      mcpComplete: true,
      dataIngestionConfirmed: true,
      slackComplete: true,
    });
    const out = frameOf(<JourneyStepper store={store} width={120} />);
    expect(out).toContain('Done ←');
  });

  it('renders nothing for non-Wizard flows (e.g. McpAdd slash-command flow)', () => {
    const store = makeStore({}, Flow.McpAdd);
    const out = frameOf(<JourneyStepper store={store} width={120} />);
    expect(out.trim()).toBe('');
  });

  it('does not double-mark Welcome as both active and complete', () => {
    const store = makeStore();
    const out = frameOf(<JourneyStepper store={store} width={120} />);
    // The active step uses the filled bullet ●, the completed uses ✓.
    // On a fresh session Welcome must be active (●), not completed (✓).
    const activeIdx = out.indexOf('● Welcome');
    const completedIdx = out.indexOf('✓ Welcome');
    expect(activeIdx).toBeGreaterThanOrEqual(0);
    expect(completedIdx).toBe(-1);
  });

  it('marks Setup as ✗ (not ✓) when the agent crashes during the run', () => {
    // Regression: pre-fix the stepper rendered every prior phase as
    // completed (✓) on the error outro because positional logic walked
    // the screen list past the failed step. A user saw
    // `✓ Welcome ─ ✓ Auth ─ ✓ Setup ─ ✓ Verify ─ ● Done` followed by
    // "Setup failed" — a direct contradiction. Now the in-progress
    // phase at crash time renders ✗ and everything after it goes back
    // to ○ (pending).
    //
    // `projectHasData: false` advances the flow past DataSetup so the
    // resolver actually lands on the Outro (the wizard's real state at
    // this point — DataSetup runs before the agent).
    const store = makeStore({
      introConcluded: true,
      region: 'us',
      credentials: CREDS,
      selectedOrgId: '123',
      selectedOrgName: 'Acme',
      selectedProjectName: 'Amplitude',
      selectedEnvName: 'Production',
      projectHasData: false,
      activationLevel: 'none',
      runPhase: RunPhase.Error,
      outroData: {
        kind: OutroKind.Error,
        message: 'Setup failed',
      },
    });
    const out = frameOf(<JourneyStepper store={store} width={120} />);
    // Welcome + Auth completed before the crash → still ✓
    expect(out).toContain('✓ Welcome');
    expect(out).toContain('✓ Auth');
    // Setup is the failed phase → ✗
    expect(out).toContain('✗ Setup');
    expect(out).not.toContain('✓ Setup');
    // Verify and Done were never reached → ○ (pending), no ✓
    expect(out).not.toContain('✓ Verify');
    expect(out).not.toContain('✓ Done');
    expect(out).not.toContain('● Done');
  });

  it('marks Auth as ✗ when the wizard fails before credentials are set', () => {
    // Auth failure (e.g. OAuth cancelled, region unreachable) should
    // not paint Welcome → Auth as completed.
    const store = makeStore({
      introConcluded: true,
      outroData: {
        kind: OutroKind.Error,
        message: 'Authentication failed',
      },
    });
    const out = frameOf(<JourneyStepper store={store} width={120} />);
    expect(out).toContain('✓ Welcome');
    expect(out).toContain('✗ Auth');
    expect(out).not.toContain('✓ Auth');
  });

  it('keeps ✓ on prior phases when the run completes successfully', () => {
    // Counter-test for the error path — make sure non-error outros still
    // show all completed phases as ✓ (no regression on the happy path).
    const store = makeStore({
      introConcluded: true,
      region: 'us',
      credentials: CREDS,
      selectedOrgId: '123',
      selectedOrgName: 'Acme',
      selectedProjectName: 'Amplitude',
      selectedEnvName: 'Production',
      projectHasData: false,
      activationLevel: 'none',
      runPhase: RunPhase.Completed,
      mcpComplete: true,
      dataIngestionConfirmed: true,
      slackComplete: true,
      outroData: {
        kind: OutroKind.Success,
      },
    });
    const out = frameOf(<JourneyStepper store={store} width={120} />);
    expect(out).not.toContain('✗');
    expect(out).toContain('✓ Welcome');
    expect(out).toContain('✓ Auth');
    expect(out).toContain('✓ Setup');
    expect(out).toContain('✓ Verify');
  });

  it('renders ✓ Done (not ● Done) when the user has reached a successful outro', () => {
    // Visual regression guard: when the user is AT Done with Success,
    // the active glyph must read as "completed" (✓), not "in progress"
    // (●). The previous behavior reused the ● glyph for every active
    // step, including Done — which made the final summary look like
    // the wizard was still working (visually indistinguishable from
    // mid-run Setup or Verify being underway).
    const store = makeStore({
      introConcluded: true,
      region: 'us',
      credentials: CREDS,
      selectedOrgName: 'Acme',
      selectedProjectName: 'Amplitude',
      selectedEnvName: 'Production',
      projectHasData: false,
      activationLevel: 'none',
      runPhase: RunPhase.Completed,
      mcpComplete: true,
      dataIngestionConfirmed: true,
      slackComplete: true,
      outroData: { kind: OutroKind.Success, changes: [] },
    });
    const out = frameOf(<JourneyStepper store={store} width={120} />);
    // Done is the current step (← cursor) and now uses the checkmark.
    expect(out).toContain('✓ Done ←');
    expect(out).not.toContain('● Done');
  });

  it('keeps the in-progress ● Done glyph for non-success outros (error / cancel)', () => {
    // The completed-success swap is gated on OutroKind.Success — error
    // and cancel paths must keep the in-progress glyph so the visual
    // difference between "succeeded" and "stopped here for some other
    // reason" stays legible. (We tint the success path with the
    // success color too; here we just guard the glyph fallback.)
    //
    // Note: this test conflicts with the milestone-based failure logic
    // for Done — Outro is the failure-step only when every prior phase
    // completed. Here all milestones pass and runPhase=Completed, so
    // failedStepLabel is 'Done' which would render ✗. Use a state where
    // failedStepLabel is null (e.g. cancelled outro) instead — then
    // Done is just `active` and the in-progress glyph applies.
    const store = makeStore({
      introConcluded: true,
      region: 'us',
      credentials: CREDS,
      selectedOrgName: 'Acme',
      selectedProjectName: 'Amplitude',
      selectedEnvName: 'Production',
      projectHasData: false,
      activationLevel: 'none',
      runPhase: RunPhase.Completed,
      mcpComplete: true,
      dataIngestionConfirmed: true,
      slackComplete: true,
      outroData: { kind: OutroKind.Cancel },
    });
    const out = frameOf(<JourneyStepper store={store} width={120} />);
    expect(out).toContain('● Done ←');
    expect(out).not.toContain('✓ Done ←');
  });

  it('keeps the active cursor on Setup throughout the agent run phase', () => {
    // Regression guard: every screen between DataSetup and DataIngestionCheck
    // must be mapped into STEP_SCREENS.Setup. If a screen is mid-flow but
    // not mapped anywhere, getCompletedScreens walks past the end of the
    // flat screen list and marks every step as completed, then snaps back
    // to active Setup when the user advances. The fix is keeping the
    // Setup group exhaustive: ActivationOptions, Setup, Run, Mcp.
    const store = makeStore({
      introConcluded: true,
      region: 'us',
      credentials: CREDS,
      selectedOrgName: 'Acme',
      selectedProjectName: 'Amplitude',
      selectedEnvName: 'Production',
      projectHasData: false,
      activationLevel: 'none',
      discoveredFeatures: ['session_replay'],
      optInFeaturesComplete: true,
    });
    const out = frameOf(<JourneyStepper store={store} width={120} />);
    expect(out).toContain('Setup ←');
    // Verify, Done must still be future — no premature ✓.
    expect(out).not.toContain('✓ Verify');
    expect(out).not.toContain('✓ Done');
  });
});
