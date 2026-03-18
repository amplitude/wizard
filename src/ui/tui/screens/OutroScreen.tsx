/**
 * OutroScreen — Summary after the agent run.
 * Reads store.session.outroData to render success, error, or cancel view.
 * Keeps the process alive until the user presses a key to exit.
 */

import { Box, Text } from 'ink';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { OutroKind } from '../../../lib/wizard-session.js';
import { Colors } from '../styles.js';
import { PickerMenu } from '../primitives/index.js';
import { getCloudUrlFromRegion } from '../../../utils/urls.js';
import opn from 'opn';

interface OutroScreenProps {
  store: WizardStore;
}

export const OutroScreen = ({ store }: OutroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const isSuccess = store.session.outroData?.kind === OutroKind.Success;

  // Any-key-to-exit only for non-success states; success uses a picker.
  useScreenInput(() => {
    if (!isSuccess) process.exit(0);
  });

  const outroData = store.session.outroData;

  if (!outroData) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Text dimColor>Finishing up...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {outroData.kind === OutroKind.Success && (
        <Box flexDirection="column">
          <Text color="green" bold>
            {'\u2714'} Successfully installed Amplitude!
          </Text>

          <Box marginTop={1}>
            <Text>
              Check <Text bold>./amplitude-setup-report.md</Text> for details
              about your integration
            </Text>
          </Box>

          {outroData.changes && outroData.changes.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="cyan" bold>
                What the agent did:
              </Text>
              {outroData.changes.map((change, i) => (
                <Text key={i}>
                  {'\u2022'} {change}
                </Text>
              ))}
            </Box>
          )}

          {store.eventPlan.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="cyan" bold>
                Events added:
              </Text>
              {store.eventPlan.map((event) => (
                <Text key={event.name}>
                  {'\u2022'} <Text bold>{event.name}</Text>
                  <Text dimColor> {event.description}</Text>
                </Text>
              ))}
            </Box>
          )}

          {outroData.docsUrl && (
            <Box marginTop={1}>
              <Text>
                Learn more: <Text color="cyan">{outroData.docsUrl}</Text>
              </Text>
            </Box>
          )}

          {outroData.continueUrl && (
            <Box>
              <Text>
                Continue onboarding:{' '}
                <Text color="cyan">{outroData.continueUrl}</Text>
              </Text>
            </Box>
          )}

          <Box marginTop={1}>
            <Text dimColor>
              Note: This wizard uses an LLM agent to analyze and modify your
              project. Please review the changes made.
            </Text>
          </Box>
          <Box>
            <Text dimColor>
              How did this work for you? Drop us a line: wizard@amplitude.com
            </Text>
          </Box>
        </Box>
      )}

      {outroData.kind === OutroKind.Error && (
        <Box flexDirection="column">
          <Text color="red" bold>
            {'\u2718'} {outroData.message || 'An error occurred'}
          </Text>
        </Box>
      )}

      {outroData.kind === OutroKind.Cancel && (
        <Box flexDirection="column">
          <Text color="yellow">
            {'\u25A0'} {outroData.message || 'Cancelled'}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        {isSuccess ? (
          <PickerMenu
            options={[
              { label: 'Open Amplitude dashboard', value: 'dashboard' },
              { label: 'Exit', value: 'exit' },
            ]}
            onSelect={(value) => {
              const choice = Array.isArray(value) ? value[0] : value;
              if (choice === 'dashboard') {
                const region = store.session.region ?? 'us';
                const url = getCloudUrlFromRegion(region);
                opn(url, { wait: false }).catch(() => { /* fire-and-forget */ });
              }
              process.exit(0);
            }}
          />
        ) : (
          <Text color={Colors.muted}>Press any key to exit</Text>
        )}
      </Box>
    </Box>
  );
};
