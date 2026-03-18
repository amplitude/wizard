/**
 * RegionSelectScreen — Choose Amplitude data-center region (US or EU).
 *
 * Appears as the very first screen so the correct OAuth URL is known
 * before the browser is opened. Skipped for returning users whose
 * region is pre-populated from ~/.ampli.json.
 *
 * Also re-shown when the /region slash command sets regionForced.
 *
 * US is focused by default — pressing Enter selects it without navigating.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { PickerMenu } from '../primitives/index.js';
import { Colors } from '../styles.js';
import type { CloudRegion } from '../../../lib/wizard-session.js';
import { AmplitudeTextLogo } from '../components/AmplitudeTextLogo.js';

interface RegionSelectScreenProps {
  store: WizardStore;
}

const REGIONS: Array<{ label: string; hint: string; value: CloudRegion }> = [
  {
    label: 'United States',
    hint: 'app.amplitude.com · default',
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

  return (
    <>
      <Box marginBottom={1}></Box>
      <AmplitudeTextLogo />
      <Box flexDirection="column" flexGrow={1} paddingTop={1}>
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={Colors.accent}>
            {session.regionForced
              ? 'Switch data-center region'
              : 'Where is your Amplitude organization?'}
          </Text>
          <Text dimColor>
            {session.regionForced
              ? `Current: ${
                  session.region?.toUpperCase() ?? 'US'
                } — pick a new region below`
              : 'Press Enter to use US (default), or select EU if your org is on the EU data center.'}
          </Text>
        </Box>

        <PickerMenu<CloudRegion>
          options={REGIONS}
          onSelect={(value) => {
            const region = Array.isArray(value) ? value[0] : value;
            store.setRegion(region);
          }}
        />
      </Box>
    </>
  );
};
