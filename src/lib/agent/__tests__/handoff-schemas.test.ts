/**
 * Bet 2 Slice 10 — three-phase handoff schemas.
 *
 * Pure schema tests. No runtime behavior is wired yet — this slice lands
 * the contract so subsequent pipeline slices can compile against it.
 */

import { describe, it, expect } from 'vitest';
import {
  AGENT_PHASES,
  parseInstrumentationReport,
  parseIntegrationReport,
  parseWizardPlan,
  type WizardPlan,
  type IntegrationReport,
  type InstrumentationReport,
} from '../handoff-schemas';

const basePlan: WizardPlan = {
  schema: 'amplitude-wizard-plan/1',
  integration: 'nextjs',
  chosenSkillId: 'integration-nextjs-app-router',
  sdkVariant: 'react',
  envVarNames: ['NEXT_PUBLIC_AMPLITUDE_API_KEY'],
  targetFiles: ['app/layout.tsx', 'app/providers.tsx'],
  predictedEvents: [
    { name: 'page viewed', description: 'Fires on every route change.' },
  ],
};

describe('parseWizardPlan', () => {
  it('accepts a valid plan', () => {
    const result = parseWizardPlan(basePlan);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.integration).toBe('nextjs');
      expect(result.value.predictedEvents).toHaveLength(1);
    }
  });

  it('rejects a plan missing chosenSkillId', () => {
    const bad = { ...basePlan, chosenSkillId: '' };
    const result = parseWizardPlan(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.phase).toBe('planner');
  });

  it('rejects non-uppercase env var names', () => {
    const bad = { ...basePlan, envVarNames: ['lowercase_key'] };
    const result = parseWizardPlan(bad);
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown sdkVariant', () => {
    const bad = { ...basePlan, sdkVariant: 'mystery' } as unknown;
    const result = parseWizardPlan(bad);
    expect(result.ok).toBe(false);
  });

  it('rejects an event name longer than 50 chars', () => {
    const bad: WizardPlan = {
      ...basePlan,
      predictedEvents: [{ name: 'x'.repeat(51), description: 'too long' }],
    };
    const result = parseWizardPlan(bad);
    expect(result.ok).toBe(false);
  });
});

describe('parseIntegrationReport', () => {
  const base: IntegrationReport = {
    schema: 'amplitude-wizard-integration/1',
    chosenSkillId: 'integration-nextjs-app-router',
    modifiedFiles: ['app/layout.tsx'],
    envVarsSet: ['NEXT_PUBLIC_AMPLITUDE_API_KEY'],
    eventPlanConfirmed: true,
    approvedEvents: [{ name: 'page viewed', description: 'all routes' }],
    warnings: [],
  };

  it('accepts a valid integration report', () => {
    const result = parseIntegrationReport(base);
    expect(result.ok).toBe(true);
  });

  it('defaults warnings to an empty array when omitted', () => {
    const rest: Omit<IntegrationReport, 'warnings'> = {
      schema: base.schema,
      chosenSkillId: base.chosenSkillId,
      modifiedFiles: base.modifiedFiles,
      envVarsSet: base.envVarsSet,
      eventPlanConfirmed: base.eventPlanConfirmed,
      approvedEvents: base.approvedEvents,
    };
    const result = parseIntegrationReport(rest);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.warnings).toEqual([]);
  });

  it('surfaces the phase label on failure', () => {
    const result = parseIntegrationReport({ schema: 'wrong' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.phase).toBe('integrator');
  });
});

describe('parseInstrumentationReport', () => {
  const base: InstrumentationReport = {
    schema: 'amplitude-wizard-instrumentation/1',
    instrumentedEvents: [{ name: 'page viewed', files: ['app/layout.tsx'] }],
    skippedEvents: [],
    dashboardCreated: true,
    dashboardUrl: 'https://example.amplitude.com/dashboards/abc',
  };

  it('accepts a valid instrumentation report', () => {
    const result = parseInstrumentationReport(base);
    expect(result.ok).toBe(true);
  });

  it('accepts a null dashboardUrl when dashboardCreated is false', () => {
    const noDashboard = {
      ...base,
      dashboardCreated: false,
      dashboardUrl: null,
    };
    const result = parseInstrumentationReport(noDashboard);
    expect(result.ok).toBe(true);
  });

  it('rejects an invalid dashboard URL', () => {
    const bad = { ...base, dashboardUrl: 'not a url' };
    const result = parseInstrumentationReport(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.phase).toBe('instrumenter');
  });

  it('rejects an instrumented event with no files', () => {
    const bad = {
      ...base,
      instrumentedEvents: [{ name: 'x', files: [] }],
    };
    const result = parseInstrumentationReport(bad);
    expect(result.ok).toBe(false);
  });
});

describe('AGENT_PHASES', () => {
  it('includes the monolithic label alongside the three-phase split', () => {
    expect(AGENT_PHASES).toContain('monolithic');
    expect(AGENT_PHASES).toContain('planner');
    expect(AGENT_PHASES).toContain('integrator');
    expect(AGENT_PHASES).toContain('instrumenter');
  });
});
