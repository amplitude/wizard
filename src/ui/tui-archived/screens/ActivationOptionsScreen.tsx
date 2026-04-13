/**
 * ActivationOptionsScreen — "What would you like to do?" prompt.
 *
 * Shown when the user has the SDK installed but hasn't fully activated yet
 * (1–49 events). Offers next-step options without forcing a full re-run.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { PickerMenu } from '../primitives/index.js';
import { Colors } from '../styles.js';
import { OutroKind } from '../../../lib/wizard-session.js';
import { OUTBOUND_URLS } from '../../../lib/constants.js';
import opn from 'opn';

interface ActivationOptionsScreenProps {
  store: WizardStore;
}

const DOCS_URL = OUTBOUND_URLS.sdkDocs;

export const ActivationOptionsScreen = ({
  store,
}: ActivationOptionsScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const { snippetConfigured } = store.session;

  const handleSelect = (value: string) => {
    switch (value) {
      case 'test-locally':
        // Route to Framework Detection by treating this as a new project
        store.setActivationOptionsComplete();
        break;
      case 'debug':
        // Run the agent in debug mode
        store.setActivationOptionsComplete();
        break;
      case 'docs':
        opn(DOCS_URL, { wait: false }).catch(() => {
          /* fire-and-forget */
        });
        // Stay on screen — don't advance
        break;
      case 'exit':
        store.setOutroData({
          kind: OutroKind.Cancel,
          message: 'Come back once your app is deployed and sending events.',
        });
        break;
    }
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={Colors.accent}>
        Your SDK is{snippetConfigured ? ' installed' : ' partially set up'} —
        waiting for events
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text color={Colors.muted}>
          We can see your project is configured but hasn&apos;t received many
          events yet.
        </Text>
        <Text color={Colors.muted}>What would you like to do?</Text>
      </Box>

      <Box marginTop={1}>
        <PickerMenu
          options={[
            {
              value: 'test-locally',
              label: 'Help me test locally',
              hint: 'run the setup agent',
            },
            { value: 'debug', label: "I'm blocked", hint: 'get help' },
            { value: 'docs', label: 'Take me to the docs', hint: DOCS_URL },
            {
              value: 'exit',
              label: "I'm done for now",
              hint: 'exit and resume later',
            },
          ]}
          onSelect={(v) => handleSelect(v as string)}
        />
      </Box>
    </Box>
  );
};
