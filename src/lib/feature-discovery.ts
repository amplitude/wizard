/**
 * Deterministic feature discovery — finds opt-in Amplitude features that
 * apply to the current project. Used by both the TUI flow (to populate the
 * FeatureOptIn picklist) and non-interactive modes (CI, agent) where the
 * results are auto-enabled without user confirmation.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { DiscoveredFeature, AdditionalFeature } from './wizard-session';
import type { WizardSession } from './wizard-session';
import { isFlagEnabled, FLAG_LLM_ANALYTICS } from './feature-flags';
import { analytics } from '../utils/analytics';

const STRIPE_PACKAGES = ['stripe', '@stripe/stripe-js'];

const LLM_PACKAGES = [
  'openai',
  '@anthropic-ai/sdk',
  'ai',
  '@ai-sdk/openai',
  'langchain',
  '@langchain/openai',
  '@langchain/langgraph',
  '@google/generative-ai',
  '@google/genai',
  '@instructor-ai/instructor',
  '@mastra/core',
  'portkey-ai',
];

const BROWSER_REPLAY_INTEGRATIONS = new Set([
  'nextjs',
  'vue',
  'react-router',
  'javascript_web',
]);

export function discoverFeatures(opts: {
  installDir: string;
  integration: string | null;
}): DiscoveredFeature[] {
  const features: DiscoveredFeature[] = [];

  try {
    const pkg = JSON.parse(
      readFileSync(join(opts.installDir, 'package.json'), 'utf-8'),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const depNames = Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    });

    if (depNames.some((d) => STRIPE_PACKAGES.includes(d))) {
      features.push(DiscoveredFeature.Stripe);
    }

    if (
      isFlagEnabled(FLAG_LLM_ANALYTICS) &&
      depNames.some((d) => LLM_PACKAGES.includes(d))
    ) {
      features.push(DiscoveredFeature.LLM);
    }
  } catch {
    // No package.json or parse error — skip dep-based discovery
  }

  if (opts.integration && BROWSER_REPLAY_INTEGRATIONS.has(opts.integration)) {
    features.push(DiscoveredFeature.SessionReplay);
    features.push(DiscoveredFeature.Engagement);
  }

  return features;
}

/**
 * Map a DiscoveredFeature to its corresponding AdditionalFeature, or null
 * if the discovery is informational only (e.g. Stripe).
 *
 * NOTE: a structural copy of this mapping also lives in
 * src/ui/tui/screens/FeatureOptInScreen.tsx (`toAdditionalFeature`). The
 * TUI layer can't import from this module at runtime because of the tsx
 * ESM/CJS dual-loading bug documented in src/ui/tui/session-constants.ts
 * — wizard-session's `as const` + same-name-type exports fail to resolve
 * when the module is first loaded as CJS and then re-imported as ESM.
 * If you add a new DiscoveredFeature variant, update BOTH copies.
 */
function discoveredToAdditional(
  feature: DiscoveredFeature,
): AdditionalFeature | null {
  if (feature === DiscoveredFeature.SessionReplay)
    return AdditionalFeature.SessionReplay;
  if (feature === DiscoveredFeature.LLM) return AdditionalFeature.LLM;
  if (feature === DiscoveredFeature.Engagement)
    return AdditionalFeature.Engagement;
  return null;
}

/** Enable a single additional feature on the session (idempotent). */
function enableAdditionalFeature(
  session: WizardSession,
  additional: AdditionalFeature,
  source: string,
): void {
  if (!session.additionalFeatureQueue.includes(additional)) {
    session.additionalFeatureQueue = [
      ...session.additionalFeatureQueue,
      additional,
    ];
  }
  if (additional === AdditionalFeature.LLM) session.llmOptIn = true;
  if (additional === AdditionalFeature.SessionReplay)
    session.sessionReplayOptIn = true;
  if (additional === AdditionalFeature.Engagement)
    session.engagementOptIn = true;

  analytics.wizardCapture('feature enabled', {
    feature: additional,
    source,
  });
}

/**
 * Auto-enable every opt-in additional feature discovered in the project.
 * Mirrors the TUI's "all defaults on" behavior for CI / agent runs.
 * Mutates the session in place and fires per-feature telemetry.
 */
export function autoEnableOptInFeatures(
  session: WizardSession,
  source: 'auto-ci' | 'auto-agent',
): void {
  const discovered = discoverFeatures({
    installDir: session.installDir,
    integration: session.integration,
  });

  session.discoveredFeatures = [...discovered];

  for (const feature of discovered) {
    const additional = discoveredToAdditional(feature);
    if (!additional) continue;
    enableAdditionalFeature(session, additional, source);
  }

  session.optInFeaturesComplete = true;
}

/**
 * Sync version used by the interactive TUI: takes the session's already-
 * populated `discoveredFeatures` (filled by `addDiscoveredFeature` calls
 * from bin.ts) and auto-enables every opt-in addon found there. No
 * picker, no opt-out — Session Replay, Guides & Surveys, and LLM (when
 * the feature flag is on) all flow into the additional feature queue
 * automatically. The agent receives inline-comment instructions via the
 * commandments so users can still tune individual options by editing
 * the generated init code.
 *
 * Why no opt-in picker:
 *   - The unified browser SDK ships with autocapture + SR + G&S in one
 *     package. There's no install cost to enabling them.
 *   - Quota concerns (autocapture / SR running up event volume) are
 *     surfaced via per-option inline comments in the generated code,
 *     where users can comment out lines they don't want — a clearer
 *     opt-out surface than a one-shot picker.
 *   - Matches the experience users get from data-setup's npm snippet,
 *     so wizard output and copy-paste docs converge.
 */
export function autoEnableInlineAddons(session: WizardSession): void {
  for (const feature of session.discoveredFeatures) {
    const additional = discoveredToAdditional(feature);
    if (!additional) continue;
    enableAdditionalFeature(session, additional, 'auto-inline');
  }
  session.optInFeaturesComplete = true;
}
