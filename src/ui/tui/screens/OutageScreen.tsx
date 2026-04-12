/**
 * OutageScreen — Shown when Claude/Anthropic services are degraded.
 * Reads session.serviceStatus and provides a ConfirmationInput to continue or exit.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { ConfirmationInput } from '../primitives/index.js';
import { Colors } from '../styles.js';

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
        <Text color="yellow" bold>
          {'\u26A0'} AI services are experiencing issues.
        </Text>
        <Box height={1} />
        <Text>
          <Text color="yellow">Status:</Text> {serviceStatus.description}
        </Text>
        <Text>
          <Text color="yellow">Status page:</Text>{' '}
          <Text color="cyan">{serviceStatus.statusPageUrl}</Text>
        </Text>
        <Box height={1} />
        <Text color={Colors.muted}>
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
