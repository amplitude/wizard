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
 * Map a DiscoveredFeature to its corresponding AdditionalFeature, or null if
 * the discovery is informational only (e.g. Stripe).
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
 * Mirrors the TUI picklist's "all defaults on" behavior for CI / agent runs.
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
 * Skip the FeatureOptIn picklist when no opt-in features were discovered
 * for this project. Pure session bookkeeping — no features are enabled
 * (the picker handles enabling whatever the user explicitly chose).
 *
 * Why this exists: Session Replay and Guides & Surveys are intentionally
 * OPT-IN, not opt-out. We previously auto-enabled both for unified-SDK
 * web frameworks on the theory that "the unified SDK already includes
 * them, so there's no real choice." That's correct technically, but
 * Amplitude wants users to make an explicit, informed call about
 * recording sessions and showing surveys before either ships into
 * production code. Auto-enabling SR is also a privacy / DPA decision
 * that should not be made silently on the user's behalf.
 *
 * Returns true when the picklist can be skipped entirely (no opt-in
 * features at all). Returns false when at least one opt-in feature is
 * present and warrants the picker.
 */
export function skipPicklistIfNoOptIns(session: WizardSession): boolean {
  const hasOptIn = session.discoveredFeatures.some(
    (f) => discoveredToAdditional(f) !== null,
  );
  if (!hasOptIn) {
    session.optInFeaturesComplete = true;
    return true;
  }
  return false;
}
