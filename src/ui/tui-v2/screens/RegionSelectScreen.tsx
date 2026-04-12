/**
 * RegionSelectScreen v2 — Choose Amplitude data-center region (US or EU).
 *
 * Appears as the very first screen so the correct OAuth URL is known
 * before the browser is opened. Skipped for returning users whose
 * region is pre-populated from ~/.ampli.json.
 *
 * Also re-shown when the /region slash command sets regionForced.
 *
 * US is focused by default — pressing Enter selects it without navigating.
 *
 * v2: uses v2 color tokens, cleaner layout with data residency hint.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { PickerMenu } from '../primitives/index.js';
import { Colors, Icons } from '../styles.js';
import type { CloudRegion } from '../../../lib/wizard-session.js';

interface RegionSelectScreenProps {
  store: WizardStore;
}

const REGIONS: Array<{ label: string; hint: string; value: CloudRegion }> = [
  {
    label: 'United States',
    hint: 'app.amplitude.com',
    value: 'us',
  },
  {
    label: 'Europe',
    hint: 'app.eu.amplitude.com',
    value: 'eu',
  },
];

export const RegionSelectScreen = ({ store }: RegionSelectScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const { session } = store;

  const heading = session.regionForced
    ? 'Switch data-center region'
    : 'Select your data region';

  const hint = session.regionForced
    ? `Current: ${session.region?.toUpperCase() ?? 'US'} ${
        Icons.dash
      } pick a new region below`
    : 'Choose where your Amplitude data is stored. This determines which data center receives your events.';

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.heading}>
          {heading}
        </Text>
        <Text color={Colors.muted}>{hint}</Text>
      </Box>

      <PickerMenu<CloudRegion>
        options={REGIONS}
        onSelect={(value) => {
          const region = Array.isArray(value) ? value[0] : value;
          store.setRegion(region);
        }}
      />

      <Box marginTop={1}>
        <Text color={Colors.muted}>
          {Icons.dot} Data residency affects API endpoints and compliance. You
          can change this later with{' '}
          <Text color={Colors.secondary}>/region</Text>.
        </Text>
      </Box>
    </Box>
  );
};
