/**
 * Deterministic feature discovery — finds opt-in Amplitude features that
 * apply to the current project. Used by both the TUI flow (to populate the
 * FeatureOptIn picklist) and non-interactive modes (CI, agent) where the
 * results are auto-enabled without user confirmation.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import {
  DiscoveredFeature,
  AdditionalFeature,
  INLINE_FEATURES,
} from './wizard-session';
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
 * Auto-enable inline addons (Session Replay + Guides & Surveys) for projects
 * using the unified browser SDK. The unified SDK is the single recommendation
 * for new browser integrations and the inline plugins are configured as part
 * of the same `initAll()` call — there's no real choice to surface to the
 * user, so we just enable both and skip the picklist for these features.
 *
 * If the project also has discovered non-inline opt-ins (e.g. LLM), we leave
 * `optInFeaturesComplete=false` so the picklist still shows for those.
 *
 * Returns true if all opt-in features were auto-enabled (no picklist needed).
 */
export function autoEnableInlineOptIns(session: WizardSession): boolean {
  const optIns = session.discoveredFeatures
    .map(discoveredToAdditional)
    .filter((f): f is AdditionalFeature => f !== null);

  if (optIns.length === 0) {
    session.optInFeaturesComplete = true;
    return true;
  }

  const inline = optIns.filter((f) => INLINE_FEATURES.has(f));
  const nonInline = optIns.filter((f) => !INLINE_FEATURES.has(f));

  for (const feature of inline) {
    enableAdditionalFeature(session, feature, 'auto-inline');
  }

  // No non-inline opt-ins remaining → no picklist needed.
  if (nonInline.length === 0) {
    session.optInFeaturesComplete = true;
    return true;
  }
  return false;
}
