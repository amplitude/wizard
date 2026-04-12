/**
 * OutageScreen — Shown when AI services are degraded (v2).
 * Reads session.serviceStatus and provides a ConfirmationInput to continue or exit.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { ConfirmationInput } from '../primitives/index.js';
import { Colors, Icons } from '../styles.js';

interface OutageScreenProps {
  store: WizardStore;
}

export const OutageScreen = ({ store }: OutageScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const serviceStatus = store.session.serviceStatus;

  if (!serviceStatus) {
    return null;
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text color={Colors.warning} bold>
          {Icons.diamond} AI services are experiencing issues.
        </Text>
        <Text> </Text>
        <Text color={Colors.body}>
          <Text color={Colors.warning}>Status:</Text>{' '}
          {serviceStatus.description}
        </Text>
        <Text color={Colors.body}>
          <Text color={Colors.warning}>Status page:</Text>{' '}
          <Text color={Colors.accent}>{serviceStatus.statusPageUrl}</Text>
        </Text>
        <Text> </Text>
        <Text color={Colors.secondary}>
          The wizard may not work reliably while services are affected.
        </Text>
      </Box>

      <ConfirmationInput
        message="Continue anyway?"
        onConfirm={() => store.popOverlay()}
        onCancel={() => process.exit(0)}
      />
    </Box>
  );
};
