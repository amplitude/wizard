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
 *
 * When the activation API is unavailable (e.g. external users hitting Thunder
 * endpoints that require browser session auth), the screen falls back to showing
 * cataloged event types from the data API so the user can verify events arrived,
 * then manually confirms with Enter.
 */

import { Box, Text } from 'ink';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { Colors, Icons } from '../styles.js';
import {
  fetchProjectActivationStatus,
  fetchWorkspaceEventTypes,
} from '../../../lib/api.js';
import type { AmplitudeZone } from '../../../lib/constants.js';
import { logToFile } from '../../../utils/debug.js';
import { OutroKind } from '../../../lib/wizard-session.js';
import { useScreenInput } from '../hooks/useScreenInput.js';

const POLL_INTERVAL_MS = 30_000;
const MAX_EVENTS_SHOWN = 8;

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
  const [apiUnavailable, setApiUnavailable] = useState(false);
  const [eventTypes, setEventTypes] = useState<string[] | null>(null);

  async function checkIngestion() {
    if (!credentials) {
      setApiUnavailable(true);
      return;
    }
    // credentials.projectId is 0 for OAuth users; fall back to workspace UUID
    const appId = credentials.projectId || session.selectedWorkspaceId;
    if (!appId) {
      setApiUnavailable(true);
      return;
    }
    const zone = (region ?? 'us') as AmplitudeZone;
    // Thunder uses access_token (Hydra-validated); data API uses id_token.
    // fetchProjectActivationStatus routes to Thunder when orgId is present,
    // so always pass access_token — the function handles the fallback.
    const token = credentials.accessToken;
    // Data API (fetchWorkspaceEventTypes) expects a raw JWT id_token.
    const dataApiToken = credentials.idToken ?? credentials.accessToken;

    try {
      const status = await fetchProjectActivationStatus(
        token,
        zone,
        appId,
        session.selectedOrgId,
        dataApiToken,
      );
      logToFile(
        `[DataIngestionCheck] poll result: hasAnyEvents=${status.hasAnyEvents} hasDetSource=${status.hasDetSource}`,
      );
      if (status.hasAnyEvents) {
        store.setDataIngestionConfirmed();
        return;
      }

      // The activation API only checks autocapture events (page_viewed,
      // session_start, session_end). Custom track() calls won't appear there.
      // Fall back to the event catalog which includes all event types.
      if (session.selectedOrgId && session.selectedWorkspaceId) {
        const catalogEvents = await fetchWorkspaceEventTypes(
          dataApiToken,
          zone,
          session.selectedOrgId,
          session.selectedWorkspaceId,
        );
        logToFile(
          `[DataIngestionCheck] catalog fallback: ${catalogEvents.length} event types found`,
        );
        if (catalogEvents.length > 0) {
          store.setDataIngestionConfirmed();
        }
      }
    } catch (err) {
      logToFile(
        `[DataIngestionCheck] poll error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      setApiUnavailable(true);

      // Fetch cataloged event types from the data API as a proxy for "events arrived"
      if (session.selectedOrgId && session.selectedWorkspaceId) {
        fetchWorkspaceEventTypes(
          dataApiToken,
          zone,
          session.selectedOrgId,
          session.selectedWorkspaceId,
        )
          .then((names) => {
            setEventTypes(names);
          })
          .catch(() => {
            setEventTypes([]);
          });
      } else {
        setEventTypes([]);
      }
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

  useScreenInput((_char, key) => {
    if (key.escape || _char === 'q') {
      if (pollingRef.current !== null) clearInterval(pollingRef.current);
      store.setOutroData({
        kind: OutroKind.Cancel,
        message:
          'Come back once your app is running and sending events. Your SDK is installed — you just need to trigger some actions.',
      });
      return;
    }
    // Manual confirmation when API is unavailable
    if (apiUnavailable && key.return) {
      if (pollingRef.current !== null) clearInterval(pollingRef.current);
      store.setDataIngestionConfirmed();
    }
  });

  const shown = eventTypes?.slice(0, MAX_EVENTS_SHOWN) ?? [];
  const overflow = (eventTypes?.length ?? 0) - MAX_EVENTS_SHOWN;

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
        {!apiUnavailable && (
          <Text color={Colors.muted}>
            Checking every 30 seconds — this screen will advance automatically.
          </Text>
        )}
      </Box>

      {apiUnavailable && eventTypes === null && (
        <Box gap={2} alignItems="center">
          <Text color={Colors.accent}>{Icons.diamond}</Text>
          <Text color={Colors.muted}>Checking your event catalog...</Text>
        </Box>
      )}

      {apiUnavailable && eventTypes !== null && eventTypes.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={Colors.muted} dimColor>
            Events cataloged in your workspace:
          </Text>
          <Box flexDirection="column" marginTop={1} marginLeft={2}>
            {shown.map((name) => (
              <Box key={name} gap={2}>
                <Text color={Colors.accent}>{Icons.diamond}</Text>
                <Text>{name}</Text>
              </Box>
            ))}
            {overflow > 0 && (
              <Text color={Colors.muted} dimColor>
                ... and {overflow} more
              </Text>
            )}
          </Box>
        </Box>
      )}

      {apiUnavailable && eventTypes !== null && eventTypes.length === 0 && (
        <Box gap={2} alignItems="center" marginBottom={1}>
          <Text color={Colors.accent}>{Icons.diamond}</Text>
          <Text color={Colors.muted}>Waiting for your events...</Text>
        </Box>
      )}

      {!apiUnavailable && (
        <Box gap={2} alignItems="center">
          <Text color={Colors.accent}>{Icons.diamond}</Text>
          <Text color={Colors.muted}>Waiting for your events...</Text>
        </Box>
      )}

      <Box marginTop={2} flexDirection="column" gap={1}>
        {apiUnavailable && (
          <Text color={Colors.muted} dimColor>
            Press{' '}
            <Text bold color={Colors.muted}>
              Enter
            </Text>{' '}
            {eventTypes && eventTypes.length > 0
              ? 'to continue'
              : 'once you see events in your Amplitude dashboard'}
          </Text>
        )}
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
