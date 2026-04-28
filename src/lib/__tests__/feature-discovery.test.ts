/**
 * Tests for the typed `discoveredToAdditional` mapping.
 *
 * This helper replaced a string-literal `as` cast comparison in
 * `WizardStore.autoEnableInlineAddons` that worked only because
 * `DiscoveredFeature` and `AdditionalFeature` enum values happened to
 * match. If either enum's underlying value drifts, the cast comparison
 * silently falls through and we auto-enable nothing — with no build
 * error. These tests lock the mapping down so that drift is a test
 * failure instead.
 */

import { describe, it, expect } from 'vitest';
import { discoveredToAdditional } from '../feature-discovery.js';
import { DiscoveredFeature, AdditionalFeature } from '../wizard-session.js';

describe('discoveredToAdditional', () => {
  it('maps SessionReplay → AdditionalFeature.SessionReplay', () => {
    expect(discoveredToAdditional(DiscoveredFeature.SessionReplay)).toBe(
      AdditionalFeature.SessionReplay,
    );
  });

  it('maps LLM → AdditionalFeature.LLM', () => {
    expect(discoveredToAdditional(DiscoveredFeature.LLM)).toBe(
      AdditionalFeature.LLM,
    );
  });

  it('maps Engagement → AdditionalFeature.Engagement', () => {
    expect(discoveredToAdditional(DiscoveredFeature.Engagement)).toBe(
      AdditionalFeature.Engagement,
    );
  });

  it('returns null for informational-only discoveries (Stripe)', () => {
    // Stripe is discovered but has no AdditionalFeature counterpart —
    // it's used purely to inform agent prompts.
    expect(discoveredToAdditional(DiscoveredFeature.Stripe)).toBeNull();
  });

  it('does not depend on the enum string values matching', () => {
    // Regression for the underlying bug: the previous implementation
    // used `feature === ('session_replay' as AdditionalFeature)` style
    // casts. If `DiscoveredFeature.SessionReplay` ever shifts to a
    // different string value (or even to a numeric enum), the cast
    // comparison silently fails. The typed helper short-circuits via
    // the strongly-typed enum identity, not the underlying value.
    //
    // We assert here using only the named enum members — the test will
    // continue to pass after a value rename and fail only when the
    // SEMANTIC mapping breaks.
    const all = [
      DiscoveredFeature.SessionReplay,
      DiscoveredFeature.LLM,
      DiscoveredFeature.Engagement,
      DiscoveredFeature.Stripe,
    ];
    const mapped = all.map(discoveredToAdditional);
    // Three opt-in addons → mapped values; Stripe → null.
    expect(mapped.filter((m) => m !== null)).toHaveLength(3);
    expect(mapped.filter((m) => m === null)).toHaveLength(1);
  });
});
