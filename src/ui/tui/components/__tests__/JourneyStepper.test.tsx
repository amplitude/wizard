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
import { render } from 'ink-testing-library';
import { JourneyStepper } from '../JourneyStepper.js';
import { WizardStore, Flow, RunPhase } from '../../store.js';
import type { WizardSession } from '../../store.js';

// eslint-disable-next-line no-control-regex
const ANSI_CSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const frameOf = (node: React.ReactElement): string => {
  const { lastFrame, unmount } = render(node);
  const out = (lastFrame() ?? '').replace(ANSI_CSI, '');
  unmount();
  return out;
};

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

  it('keeps the active cursor on Setup while on the feature opt-in screen', () => {
    // Regression guard: FeatureOptIn previously wasn't mapped into any
    // STEP_SCREENS group, which made getCompletedScreens walk past the end
    // of the flat screen list and mark every step ✓ — and then "snap back"
    // to ● Setup when the user advanced to Run. Both bugs share one fix:
    // FeatureOptIn must live inside STEP_SCREENS.Setup.
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
      optInFeaturesComplete: false,
    });
    const out = frameOf(<JourneyStepper store={store} width={120} />);
    expect(out).toContain('Setup ←');
    // Verify, Done must still be future — no premature ✓.
    expect(out).not.toContain('✓ Verify');
    expect(out).not.toContain('✓ Done');
  });
});
