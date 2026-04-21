/**
 * PR 3.2 — typed experiment registry.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { wizardCaptureSpy, getFlagSpy } = vi.hoisted(() => ({
  wizardCaptureSpy: vi.fn(),
  getFlagSpy: vi.fn(),
}));

vi.mock('../../utils/analytics', () => ({
  analytics: { wizardCapture: wizardCaptureSpy },
}));

vi.mock('../feature-flags', () => ({
  getFlag: getFlagSpy,
}));

vi.mock('../observability', () => ({
  getRunId: () => 'test-run-id',
}));

import {
  EXP_AGENT_ANALYTICS,
  useExperiment,
  getAssignments,
  setAssignments,
  _resetForTest,
} from '../experiments';

describe('experiments registry', () => {
  beforeEach(() => {
    wizardCaptureSpy.mockReset();
    getFlagSpy.mockReset();
    _resetForTest();
  });

  it('returns the default variant when the flag is unset', () => {
    getFlagSpy.mockReturnValue(undefined);
    const variant = useExperiment(EXP_AGENT_ANALYTICS);
    expect(variant).toBe(EXP_AGENT_ANALYTICS.defaultVariant);
  });

  it('returns the flag value when it matches a declared variant', () => {
    getFlagSpy.mockReturnValue('off');
    const variant = useExperiment(EXP_AGENT_ANALYTICS);
    expect(variant).toBe('off');
  });

  it('falls back to default for unrecognized variant values', () => {
    getFlagSpy.mockReturnValue('bogus');
    const variant = useExperiment(EXP_AGENT_ANALYTICS);
    expect(variant).toBe(EXP_AGENT_ANALYTICS.defaultVariant);
  });

  it('emits `experiment exposed` exactly once per flag per run', () => {
    getFlagSpy.mockReturnValue('on');
    useExperiment(EXP_AGENT_ANALYTICS);
    useExperiment(EXP_AGENT_ANALYTICS);
    useExperiment(EXP_AGENT_ANALYTICS);

    expect(wizardCaptureSpy).toHaveBeenCalledTimes(1);
    expect(wizardCaptureSpy).toHaveBeenCalledWith('experiment exposed', {
      flag: EXP_AGENT_ANALYTICS.key,
      variant: 'on',
      'run id': 'test-run-id',
    });
  });

  it('preserves bucketing across save/load via getAssignments/setAssignments', () => {
    getFlagSpy.mockReturnValue('off');
    useExperiment(EXP_AGENT_ANALYTICS);
    const snapshot = getAssignments();
    expect(snapshot[EXP_AGENT_ANALYTICS.key]).toBe('off');

    _resetForTest();
    wizardCaptureSpy.mockReset();

    // After reset, flag now returns 'on' — but the restored assignment should win.
    getFlagSpy.mockReturnValue('on');
    setAssignments(snapshot);
    const variant = useExperiment(EXP_AGENT_ANALYTICS);
    expect(variant).toBe('off');
  });

  it('re-fires exposure after assignments are restored from checkpoint', () => {
    // First run — user gets bucketed into 'off' and exposure fires.
    getFlagSpy.mockReturnValue('off');
    useExperiment(EXP_AGENT_ANALYTICS);
    expect(wizardCaptureSpy).toHaveBeenCalledTimes(1);
    const snapshot = getAssignments();

    // Process restart — exposures cleared, assignments hydrated from disk.
    _resetForTest();
    wizardCaptureSpy.mockReset();
    setAssignments(snapshot);

    // useExperiment on the resumed run fires exposure once for the new run id.
    useExperiment(EXP_AGENT_ANALYTICS);
    expect(wizardCaptureSpy).toHaveBeenCalledTimes(1);
  });
});
