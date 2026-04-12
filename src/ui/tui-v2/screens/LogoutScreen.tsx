/**
 * LogoutScreen — Confirms and clears stored OAuth credentials (v2).
 *
 * Used as an overlay triggered by the /logout slash command.
 * Calls clearStoredCredentials() on confirm, then pops the overlay.
 */

import { Box, Text } from 'ink';
import { useState, useEffect, useRef } from 'react';
import { ConfirmationInput } from '../primitives/index.js';
import { Colors } from '../styles.js';
import { clearStoredCredentials } from '../../../utils/ampli-settings.js';
import { clearApiKey } from '../../../utils/api-key-store.js';

interface LogoutScreenProps {
  onComplete: () => void;
  installDir: string;
}

enum Phase {
  Confirm = 'confirm',
  Done = 'done',
}

export const LogoutScreen = ({ onComplete, installDir }: LogoutScreenProps) => {
  const [phase, setPhase] = useState<Phase>(Phase.Confirm);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const handleConfirm = () => {
    clearStoredCredentials();
    clearApiKey(installDir);
    setPhase(Phase.Done);
    timerRef.current = setTimeout(onComplete, 1500);
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
          <Text color={Colors.secondary}>
            Logged out. Restart the wizard to re-authenticate.
          </Text>
        )}
      </Box>
    </Box>
  );
};
