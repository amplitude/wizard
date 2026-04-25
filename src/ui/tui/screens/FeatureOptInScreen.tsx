/**
 * FeatureOptInScreen — multi-select picklist for opt-in additional features.
 *
 * Shown after detection finds at least one opt-in feature (LLM, Session
 * Replay) and only in interactive TUI mode. ESC continues with nothing
 * selected. ENTER confirms the current selection. All checkboxes default on.
 */

import { Box, Text } from 'ink';
import { useEffect } from 'react';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { PickerMenu } from '../primitives/index.js';
import { Colors, Icons } from '../styles.js';
import { DiscoveredFeature } from '../../../lib/wizard-session.js';
import { analytics } from '../../../utils/analytics.js';
import {
  AdditionalFeature,
  ADDITIONAL_FEATURE_LABELS,
} from '../session-constants.js';

interface FeatureOptInScreenProps {
  store: WizardStore;
}

const FEATURE_HINTS: Record<AdditionalFeature, string> = {
  [AdditionalFeature.SessionReplay]: 'Watch user sessions like a video',
  [AdditionalFeature.LLM]: 'Track AI agent calls',
};

/**
 * Map a discovered feature to its corresponding additional feature.
 * Stripe is not an opt-in feature so it returns null.
 */
function toAdditionalFeature(
  feature: DiscoveredFeature,
): AdditionalFeature | null {
  if (feature === DiscoveredFeature.SessionReplay)
    return AdditionalFeature.SessionReplay;
  if (feature === DiscoveredFeature.LLM) return AdditionalFeature.LLM;
  return null;
}

export const FeatureOptInScreen = ({ store }: FeatureOptInScreenProps) => {
  useWizardStore(store);

  const optInFeatures: AdditionalFeature[] = [];
  for (const f of store.session.discoveredFeatures) {
    const additional = toAdditionalFeature(f);
    if (additional) optInFeatures.push(additional);
  }

  // ESC = continue with nothing selected.
  useScreenInput((_input, key) => {
    if (key.escape) {
      store.confirmFeatureOptIns([]);
    }
  });

  // Defensive: the show predicate keeps us off this screen when nothing was
  // discovered, but auto-advance just in case so we never deadlock.
  const empty = optInFeatures.length === 0;
  useEffect(() => {
    if (empty) store.confirmFeatureOptIns([]);
  }, [empty, store]);

  // Telemetry: capture which features the user was offered so we can compute
  // per-feature selection rate (denominator = offered, numerator = enabled).
  // Fires once on mount; empty deps are intentional — discoveredFeatures is
  // stable for the lifetime of this screen.
  useEffect(() => {
    if (!empty) {
      analytics.wizardCapture('feature opt-in shown', {
        offered: optInFeatures,
      });
    }
  }, []);

  if (empty) return null;

  const options = optInFeatures.map((feature) => ({
    label: ADDITIONAL_FEATURE_LABELS[feature],
    value: feature,
    hint: FEATURE_HINTS[feature],
  }));

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.accent}>
          Add more to your setup
        </Text>
        <Text color={Colors.secondary}>
          We&apos;ll wire these up after the main integration. {Icons.dash} ESC
          to skip
        </Text>
      </Box>

      <PickerMenu<AdditionalFeature>
        mode="multi"
        options={options}
        defaultSelected={optInFeatures}
        onSelect={(value) => {
          const selected = Array.isArray(value) ? value : [value];
          store.confirmFeatureOptIns(selected);
        }}
      />
    </Box>
  );
};
