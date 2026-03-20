/**
 * UserIdentifyConfirmScreen — Overlay shown mid-run when the agent finds an auth
 * location and wants the user to confirm before writing setUserId() there.
 *
 * Follows the same pattern as SettingsOverrideScreen: pushed as an overlay,
 * blocks the agent (via a Promise in the store), and pops itself on resolve.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { ConfirmationInput } from '../primitives/index.js';
import { Icons } from '../styles.js';

interface UserIdentifyConfirmScreenProps {
  store: WizardStore;
}

export const UserIdentifyConfirmScreen = ({
  store,
}: UserIdentifyConfirmScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const confirmation = store.session.userIdentifyConfirmation;

  if (!confirmation) {
    return null;
  }

  const { filePath, line, proposedCode, context } = confirmation;

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
    >
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyan"
        paddingX={3}
        paddingY={1}
        width={72}
      >
        <Box justifyContent="center" marginBottom={1}>
          <Text color="cyan" bold>
            {Icons.diamond} User Identification Found
          </Text>
        </Box>

        <Text>{context}</Text>

        <Box flexDirection="column" marginY={1} paddingLeft={2}>
          <Text dimColor>
            {filePath}
            <Text color="yellow">:{line}</Text>
          </Text>
          <Text color="green">{proposedCode}</Text>
        </Box>

        <Text dimColor>
          Confirm to add this call now, or decline to leave a TODO comment after
          init() instead — you can wire it up manually at any time.
        </Text>

        <Box marginY={1}>
          <Text dimColor>{'─'.repeat(64)}</Text>
        </Box>

        <ConfirmationInput
          message="Add setUserId() here?"
          confirmLabel="Add it [Enter]"
          cancelLabel="Leave a TODO instead [Esc]"
          onConfirm={() => store.resolveUserIdentifyConfirmation(true)}
          onCancel={() => store.resolveUserIdentifyConfirmation(false)}
        />
      </Box>
    </Box>
  );
};
