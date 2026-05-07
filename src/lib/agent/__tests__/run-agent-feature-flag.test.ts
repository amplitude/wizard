import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AI_SDK_INNER_LOOP_ENV_VAR,
  isAiSdkInnerLoopEnabled,
} from '../run-agent-feature-flag.js';

describe('isAiSdkInnerLoopEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns false when env var is unset', () => {
    vi.stubEnv(AI_SDK_INNER_LOOP_ENV_VAR, undefined);
    expect(isAiSdkInnerLoopEnabled()).toBe(false);
  });

  it('returns false when env var is empty string', () => {
    expect(isAiSdkInnerLoopEnabled('')).toBe(false);
  });

  it('returns true for canonical "1" value', () => {
    expect(isAiSdkInnerLoopEnabled('1')).toBe(true);
  });

  it('accepts "true" and "yes" with case-insensitive match', () => {
    expect(isAiSdkInnerLoopEnabled('true')).toBe(true);
    expect(isAiSdkInnerLoopEnabled('TRUE')).toBe(true);
    expect(isAiSdkInnerLoopEnabled('yes')).toBe(true);
    expect(isAiSdkInnerLoopEnabled('Yes')).toBe(true);
  });

  it('rejects truthy-looking values that are not in the canonical set', () => {
    expect(isAiSdkInnerLoopEnabled('0')).toBe(false);
    expect(isAiSdkInnerLoopEnabled('false')).toBe(false);
    expect(isAiSdkInnerLoopEnabled('off')).toBe(false);
    expect(isAiSdkInnerLoopEnabled('y')).toBe(false);
  });

  it('reads from process.env when no argument passed', () => {
    vi.stubEnv(AI_SDK_INNER_LOOP_ENV_VAR, '1');
    expect(isAiSdkInnerLoopEnabled()).toBe(true);

    vi.stubEnv(AI_SDK_INNER_LOOP_ENV_VAR, '0');
    expect(isAiSdkInnerLoopEnabled()).toBe(false);
  });

  it('exports a stable env-var name', () => {
    // Pinned so external orchestrators can rely on the contract.
    expect(AI_SDK_INNER_LOOP_ENV_VAR).toBe(
      'AMPLITUDE_WIZARD_AI_SDK_INNER_LOOP',
    );
  });
});
