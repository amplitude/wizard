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
  type ExperimentDef,
  useExperiment,
  getAssignments,
  setAssignments,
  _resetForTest,
} from '../experiments';

const TEST_EXPERIMENT: ExperimentDef<'on' | 'off'> = {
  key: 'wizard-test-experiment',
  description: 'Test-only experiment fixture.',
  defaultVariant: 'on',
  variants: {
    on: { description: 'Enabled.' },
    off: { description: 'Disabled.' },
  },
  scope: 'per-user',
};

describe('experiments registry', () => {
  beforeEach(() => {
    wizardCaptureSpy.mockReset();
    getFlagSpy.mockReset();
    _resetForTest();
  });

  it('returns the default variant when the flag is unset', () => {
    getFlagSpy.mockReturnValue(undefined);
    const variant = useExperiment(TEST_EXPERIMENT);
    expect(variant).toBe(TEST_EXPERIMENT.defaultVariant);
  });

  it('returns the flag value when it matches a declared variant', () => {
    getFlagSpy.mockReturnValue('off');
    const variant = useExperiment(TEST_EXPERIMENT);
    expect(variant).toBe('off');
  });

  it('falls back to default for unrecognized variant values', () => {
    getFlagSpy.mockReturnValue('bogus');
    const variant = useExperiment(TEST_EXPERIMENT);
    expect(variant).toBe(TEST_EXPERIMENT.defaultVariant);
  });

  it('emits `experiment exposed` exactly once per flag per run', () => {
    getFlagSpy.mockReturnValue('on');
    useExperiment(TEST_EXPERIMENT);
    useExperiment(TEST_EXPERIMENT);
    useExperiment(TEST_EXPERIMENT);

    expect(wizardCaptureSpy).toHaveBeenCalledTimes(1);
    expect(wizardCaptureSpy).toHaveBeenCalledWith('experiment exposed', {
      flag: TEST_EXPERIMENT.key,
      variant: 'on',
      'run id': 'test-run-id',
    });
  });

  it('preserves bucketing across save/load via getAssignments/setAssignments', () => {
    getFlagSpy.mockReturnValue('off');
    useExperiment(TEST_EXPERIMENT);
    const snapshot = getAssignments();
    expect(snapshot[TEST_EXPERIMENT.key]).toBe('off');

    _resetForTest();
    wizardCaptureSpy.mockReset();

    // After reset, flag now returns 'on' — but the restored assignment should win.
    getFlagSpy.mockReturnValue('on');
    setAssignments(snapshot);
    const variant = useExperiment(TEST_EXPERIMENT);
    expect(variant).toBe('off');
  });

  it('re-fires exposure after assignments are restored from checkpoint', () => {
    // First run — user gets bucketed into 'off' and exposure fires.
    getFlagSpy.mockReturnValue('off');
    useExperiment(TEST_EXPERIMENT);
    expect(wizardCaptureSpy).toHaveBeenCalledTimes(1);
    const snapshot = getAssignments();

    // Process restart — exposures cleared, assignments hydrated from disk.
    _resetForTest();
    wizardCaptureSpy.mockReset();
    setAssignments(snapshot);

    // useExperiment on the resumed run fires exposure once for the new run id.
    useExperiment(TEST_EXPERIMENT);
    expect(wizardCaptureSpy).toHaveBeenCalledTimes(1);
  });
});
