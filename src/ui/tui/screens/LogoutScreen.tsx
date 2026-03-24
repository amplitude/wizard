/**
 * LogoutScreen — Confirms and clears stored OAuth credentials.
 *
 * Used as an overlay triggered by the /logout slash command.
 * Calls clearStoredCredentials() on confirm, then pops the overlay.
 */

import { Box, Text } from 'ink';
import { useState } from 'react';
import { ConfirmationInput } from '../primitives/index.js';
import { Colors } from '../styles.js';
import { clearStoredCredentials } from '../../../utils/ampli-settings.js';

interface LogoutScreenProps {
  onComplete: () => void;
}

enum Phase {
  Confirm = 'confirm',
  Done = 'done',
}

export const LogoutScreen = ({ onComplete }: LogoutScreenProps) => {
  const [phase, setPhase] = useState<Phase>(Phase.Confirm);

  const handleConfirm = () => {
    clearStoredCredentials();
    setPhase(Phase.Done);
    setTimeout(onComplete, 1500);
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={Colors.accent}>
        Log Out
      </Text>

      <Box marginTop={1} flexDirection="column">
        {phase === Phase.Confirm && (
          <ConfirmationInput
            message="Clear stored Amplitude credentials from ~/.ampli.json?"
            confirmLabel="Log out"
            cancelLabel="Cancel"
            onConfirm={handleConfirm}
            onCancel={onComplete}
          />
        )}

        {phase === Phase.Done && (
          <Text color={Colors.muted}>
            Logged out. Restart the wizard to re-authenticate.
          </Text>
        )}
      </Box>
    </Box>
  );
};
