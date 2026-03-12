/**
 * RegionSelectScreen — Choose Amplitude data-center region (US or EU).
 *
 * Normal flow: region is auto-detected from the OAuth token by bin.ts and set
 * via store.setOAuthComplete(), so this screen is skipped entirely.
 *
 * This screen only appears when:
 *   - Region detection failed (session.region === null after auth), OR
 *   - The user issues the /region slash command (session.regionForced === true)
 *
 * On selection the router advances automatically (isComplete returns true).
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { PickerMenu } from '../primitives/index.js';
import { Colors } from '../styles.js';
import type { CloudRegion } from '../../../lib/wizard-session.js';

interface RegionSelectScreenProps {
  store: WizardStore;
}

const REGIONS: Array<{ label: string; hint: string; value: CloudRegion }> = [
  {
    label: 'United States',
    hint: 'api.amplitude.com',
    value: 'us',
  },
  {
    label: 'Europe',
    hint: 'api.eu.amplitude.com',
    value: 'eu',
  },
];

export const RegionSelectScreen = ({ store }: RegionSelectScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const { session } = store;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.accent}>
          Select your Amplitude data-center region
        </Text>
        <Text dimColor>
          Choose the region where your Amplitude organization stores data.
        </Text>
        {session.regionForced && session.region && (
          <Text dimColor>Current: {session.region.toUpperCase()}</Text>
        )}
      </Box>

      <PickerMenu<CloudRegion>
        options={REGIONS}
        onSelect={(value) => {
          const region = Array.isArray(value) ? value[0] : value;
          store.setRegion(region);
        }}
      />
    </Box>
  );
};
