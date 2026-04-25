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
    let additional: AdditionalFeature | null = null;
    if (feature === DiscoveredFeature.SessionReplay)
      additional = AdditionalFeature.SessionReplay;
    else if (feature === DiscoveredFeature.LLM)
      additional = AdditionalFeature.LLM;
    else if (feature === DiscoveredFeature.Engagement)
      additional = AdditionalFeature.Engagement;
    if (!additional) continue;

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

  session.optInFeaturesComplete = true;
}
