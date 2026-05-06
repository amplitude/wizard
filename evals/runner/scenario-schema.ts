/**
 * Zod schema for `scenario.json` files.
 *
 * Source of truth for what a scenario manifest must contain. Validated
 * at load time so a typo in `expectedSdkPackage` (or a missing required
 * field) is caught before scoring runs — without this, a typo silently
 * flips Layer 0's correct-sdk-package scorer into a false pass.
 *
 * The runtime `Scenario` type is derived from this schema via
 * `z.infer`; `runner/types.ts` re-exports it so callers use one name.
 */

import { z } from 'zod';

import { FRAMEWORK_TO_SDK } from './framework-sdk-table.js';

/**
 * Ring assignment — see `docs/evals.md` § three-ring stratification.
 * 1 = PR gate, 2 = nightly, 3 = pre-release.
 */
const RingSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const ScenarioSchema = z
  .object({
    name: z.string().min(1, 'scenario name must be non-empty'),
    ring: RingSchema,
    integrationHint: z
      .string()
      .min(1, 'integrationHint must be non-empty (used by --integration)'),
    buildCommand: z
      .array(z.string().min(1))
      .min(1, 'buildCommand cannot be empty'),
    /**
     * Optional — when omitted, the SDK family defaults from
     * {@link FRAMEWORK_TO_SDK} based on `integrationHint`. Set this only
     * when a scenario deliberately diverges from the project rule
     * ("Browser frameworks must use @amplitude/unified" etc.) — and
     * pair it with `sdkOverrideReason`.
     */
    expectedSdkPackage: z.string().min(1).optional(),
    sdkOverrideReason: z.string().min(1).optional(),
    expectedEnvPrefix: z.string(),
    expectedInitFile: z.string().min(1),
    expectedEvents: z.array(z.string().min(1)).default([]),
    forbiddenPaths: z.array(z.string().min(1)).default([]),
    /**
     * Controls whether the runner passes `--integration <hint>` to
     * the wizard.
     *
     *   - `true` (default): runner forwards `--integration
     *     <integrationHint>`. The wizard skips its detection pipeline
     *     and the scenario evaluates the integration path
     *     deterministically. This is the right setting for almost
     *     every scenario — we want SDK-integration regressions
     *     (wrong package, wrong init, missing env wiring) graded
     *     independently of detection drift.
     *
     *   - `false`: runner drops `--integration`, the wizard runs
     *     full framework detection against the pristine fixture, and
     *     downstream scorers grade detection accuracy. `integrationHint`
     *     is still required — it's the ground truth the detector
     *     should land on.
     */
    useDetection: z.boolean().default(true),
    notes: z.string().optional(),
  })
  // Cross-field invariant: override + reason travel together. A
  // scenario that overrides the table without a written reason is
  // exactly the regression class this issue is meant to prevent.
  .refine((s) => (s.expectedSdkPackage ? !!s.sdkOverrideReason : true), {
    message:
      'expectedSdkPackage requires sdkOverrideReason — explain why this scenario diverges from the framework→SDK table.',
    path: ['sdkOverrideReason'],
  })
  .refine((s) => (s.sdkOverrideReason ? !!s.expectedSdkPackage : true), {
    message:
      'sdkOverrideReason requires expectedSdkPackage — set the package the override is justifying.',
    path: ['expectedSdkPackage'],
  })
  // Default-from-table sanity: if no override is provided, the
  // integrationHint MUST be in the table. Catches a typo in
  // integrationHint at load time rather than as a confused
  // correct-sdk-package failure later.
  .refine(
    (s) =>
      s.expectedSdkPackage !== undefined ||
      s.integrationHint in FRAMEWORK_TO_SDK,
    {
      message:
        'integrationHint not in framework→SDK table; either fix the hint or supply expectedSdkPackage + sdkOverrideReason.',
      path: ['integrationHint'],
    },
  );

export type Scenario = z.infer<typeof ScenarioSchema>;

/**
 * Parse + validate a raw scenario object. Throws a `ZodError` with a
 * useful path when invalid; loaders should surface its `.issues` to the
 * caller rather than swallowing them.
 */
export function parseScenario(raw: unknown): Scenario {
  return ScenarioSchema.parse(raw);
}

/**
 * Resolve the SDK package this scenario expects. Either the scenario
 * carries an explicit override (paired with reason) or we look it up
 * in the table by `integrationHint`. The schema guarantees one of the
 * two paths is satisfied, so callers can trust the return value.
 */
export function resolveExpectedSdkPackage(scenario: Scenario): string {
  if (scenario.expectedSdkPackage) return scenario.expectedSdkPackage;
  const fromTable = FRAMEWORK_TO_SDK[scenario.integrationHint];
  if (!fromTable) {
    throw new Error(
      `framework→SDK table has no entry for integrationHint=${scenario.integrationHint}; this should have been caught by the schema`,
    );
  }
  return fromTable;
}
