/**
 * DataIngestionCheckScreen — "Waiting for your events..." polling screen.
 *
 * Shown after MCP setup. Polls the activation API every 30 seconds until the
 * project starts receiving events, then auto-advances to the Checklist.
 *
 * For users who were already fully activated (activationLevel === 'full') when
 * the wizard started, this screen confirms immediately on mount without polling.
 *
 * The user can exit and come back later — next time through, DataSetupScreen
 * will re-check activation and this screen will confirm immediately if events
 * have arrived.
 */

import { Box, Text } from 'ink';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { Colors, Icons } from '../styles.js';
import { fetchProjectActivationStatus } from '../../../lib/api.js';
import type { AmplitudeZone } from '../../../lib/constants.js';
import { logToFile } from '../../../utils/debug.js';
import { OutroKind } from '../../../lib/wizard-session.js';
import { useScreenInput } from '../hooks/useScreenInput.js';

const POLL_INTERVAL_MS = 30_000;

interface DataIngestionCheckScreenProps {
  store: WizardStore;
}

export const DataIngestionCheckScreen = ({
  store,
}: DataIngestionCheckScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const { session } = store;
  const { credentials, region, activationLevel } = session;
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function checkIngestion() {
    if (!credentials) return;
    const appId = credentials.projectId;
    const zone = (region ?? 'us') as AmplitudeZone;

    try {
      const status = await fetchProjectActivationStatus(
        credentials.accessToken,
        zone,
        appId,
      );
      logToFile(
        `[DataIngestionCheck] poll result: hasAnyEvents=${status.hasAnyEvents} hasDetSource=${status.hasDetSource}`,
      );
      if (status.hasAnyEvents) {
        store.setDataIngestionConfirmed();
      }
    } catch (err) {
      logToFile(
        `[DataIngestionCheck] poll error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  useEffect(() => {
    // Already fully activated — confirm immediately and skip polling
    if (activationLevel === 'full') {
      store.setDataIngestionConfirmed();
      return;
    }

    // Run once immediately, then set up the interval
    void checkIngestion();
    pollingRef.current = setInterval(() => {
      void checkIngestion();
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollingRef.current !== null) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  // Allow user to exit and come back later
  useScreenInput((_char, key) => {
    if (key.escape || _char === 'q') {
      if (pollingRef.current !== null) clearInterval(pollingRef.current);
      store.setOutroData({
        kind: OutroKind.Cancel,
        message:
          'Come back once your app is running and sending events. Your SDK is installed — you just need to trigger some actions.',
      });
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color={Colors.accent}>
          Waiting for your events
        </Text>
      </Box>

      <Box flexDirection="column" gap={1} marginBottom={2}>
        <Text>
          Your SDK is installed. Once you run your app and trigger some actions,
          events will start flowing into Amplitude.
        </Text>
        <Text color={Colors.muted}>
          Checking every 30 seconds — this screen will advance automatically.
        </Text>
      </Box>

      <Box gap={2} alignItems="center">
        <Text color={Colors.accent}>{Icons.diamond}</Text>
        <Text color={Colors.muted}>Waiting for your events...</Text>
      </Box>

      <Box marginTop={2}>
        <Text color={Colors.muted} dimColor>
          Press{' '}
          <Text bold color={Colors.muted}>
            q
          </Text>{' '}
          or{' '}
          <Text bold color={Colors.muted}>
            Esc
          </Text>{' '}
          to exit and resume later
        </Text>
      </Box>
    </Box>
  );
};
