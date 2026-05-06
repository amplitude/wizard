/**
 * Schema regression tests. Catches the failure mode where a typo in
 * `scenario.json` silently flips Layer 0 into a false pass — the
 * whole reason scenarios are validated at load time.
 */

import { describe, expect, it } from 'vitest';

import { FRAMEWORK_TO_SDK } from '../framework-sdk-table.js';
import {
  parseScenario,
  resolveExpectedSdkPackage,
} from '../scenario-schema.js';

const VALID_BASE = {
  name: 'test/vanilla',
  ring: 1 as const,
  integrationHint: 'nextjs',
  buildCommand: ['pnpm', 'build'],
  expectedEnvPrefix: 'NEXT_PUBLIC_',
  expectedInitFile: 'src/app/AmplitudeProvider.tsx',
  expectedEvents: ['Page Viewed'],
  forbiddenPaths: ['next.config.mjs'],
};

describe('parseScenario', () => {
  it('accepts a minimal valid scenario and defaults SDK from the table', () => {
    const s = parseScenario(VALID_BASE);
    expect(s.expectedSdkPackage).toBeUndefined();
    expect(resolveExpectedSdkPackage(s)).toBe(FRAMEWORK_TO_SDK.nextjs);
  });

  it('accepts an explicit override paired with a reason', () => {
    const s = parseScenario({
      ...VALID_BASE,
      expectedSdkPackage: '@amplitude/analytics-browser',
      sdkOverrideReason:
        'legacy fixture; documents the wrong-family failure mode',
    });
    expect(resolveExpectedSdkPackage(s)).toBe('@amplitude/analytics-browser');
  });

  it('rejects an override without a reason', () => {
    expect(() =>
      parseScenario({
        ...VALID_BASE,
        expectedSdkPackage: '@amplitude/analytics-browser',
      }),
    ).toThrow(/sdkOverrideReason/);
  });

  it('rejects a reason without an override', () => {
    expect(() =>
      parseScenario({
        ...VALID_BASE,
        sdkOverrideReason: 'no override; this should fail',
      }),
    ).toThrow(/expectedSdkPackage/);
  });

  it('rejects an integrationHint not in the table when no override is set', () => {
    expect(() =>
      parseScenario({
        ...VALID_BASE,
        integrationHint: 'totally-not-a-framework',
      }),
    ).toThrow(/framework→SDK table/);
  });

  it('rejects a missing required field', () => {
    const { integrationHint, ...withoutHint } = VALID_BASE;
    void integrationHint;
    expect(() => parseScenario(withoutHint)).toThrow();
  });

  it('rejects a wrong-typed ring', () => {
    expect(() => parseScenario({ ...VALID_BASE, ring: 4 })).toThrow();
  });
});
