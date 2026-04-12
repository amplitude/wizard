/**
 * DataIngestionCheckScreen (v2) — "Start your app and trigger some actions" polling screen.
 *
 * Shown after MCP setup. Polls the activation API every 30 seconds until the
 * project starts receiving events, then auto-advances to the Checklist.
 *
 * v2 changes:
 *   - Active guidance as prominent instruction with framework-aware hint
 *   - BrailleSpinner while waiting instead of static diamond icon
 *   - Success celebration when events arrive (brief green display before auto-advance)
 *   - Same business logic: polling, activation API, event catalog fallback
 */

import { Box, Text } from 'ink';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { Colors, Icons } from '../styles.js';
import { BrailleSpinner } from '../components/BrailleSpinner.js';
import { useScreenInput } from '../hooks/useScreenInput.js';
import {
  fetchProjectActivationStatus,
  fetchWorkspaceEventTypes,
} from '../../../lib/api.js';
import type { AmplitudeZone } from '../../../lib/constants.js';
import { Integration } from '../../../lib/constants.js';
import { OutroKind } from '../../../lib/wizard-session.js';
import { logToFile } from '../../../utils/debug.js';

const POLL_INTERVAL_MS = 30_000;
const MAX_EVENTS_SHOWN = 8;
const CELEBRATION_DELAY_MS = 1_500;

/** Framework-specific hints for what the user should do to generate events. */
const FRAMEWORK_HINTS: Partial<Record<Integration, string>> = {
  [Integration.nextjs]: 'Visit localhost:3000 and click around',
  [Integration.vue]: 'Visit localhost:5173 and interact with your app',
  [Integration.reactRouter]: 'Visit localhost:3000 and navigate between pages',
  [Integration.django]: 'Visit localhost:8000 and browse a few pages',
  [Integration.flask]: 'Visit localhost:5000 and trigger some requests',
  [Integration.fastapi]: 'Visit localhost:8000/docs and try some endpoints',
  [Integration.reactNative]:
    'Open your app on a device or emulator and tap around',
  [Integration.swift]: 'Build and run your app, then interact with it',
  [Integration.android]: 'Build and run your app, then interact with it',
  [Integration.flutter]: 'Run your app and navigate through a few screens',
};

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
  const [celebrating, setCelebrating] = useState(false);
  const [arrivedEvents, setArrivedEvents] = useState<string[]>([]);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [secondsSince, setSecondsSince] = useState(0);

  /** Confirm ingestion with a brief celebration before advancing. */
  function confirmWithCelebration(events?: string[]) {
    if (pollingRef.current !== null) clearInterval(pollingRef.current);
    setCelebrating(true);
    if (events && events.length > 0) setArrivedEvents(events);
    setTimeout(() => {
      store.setDataIngestionConfirmed();
    }, CELEBRATION_DELAY_MS);
  }

  async function checkIngestion() {
    if (!credentials) {
      setApiUnavailable(true);
      return;
    }
    const appId = credentials.projectId || session.selectedWorkspaceId;
    if (!appId) {
      setApiUnavailable(true);
      return;
    }
    const zone = (region ?? 'us') as AmplitudeZone;
    const dataApiToken = credentials.idToken ?? credentials.accessToken;

    if (!session.selectedOrgId) {
      setApiUnavailable(true);
      return;
    }

    try {
      const status = await fetchProjectActivationStatus({
        accessToken: credentials.accessToken,
        zone,
        appId,
        orgId: session.selectedOrgId,
      });
      setLastChecked(Date.now());
      logToFile(
        `[DataIngestionCheck] poll result: hasAnyEvents=${status.hasAnyEvents} hasDetSource=${status.hasDetSource}`,
      );
      if (status.hasAnyEvents) {
        confirmWithCelebration();
        return;
      }

      // Activation API only checks autocapture events. Fall back to the
      // event catalog which includes all event types.
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
          confirmWithCelebration(catalogEvents);
        }
      }
    } catch (err) {
      logToFile(
        `[DataIngestionCheck] poll error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      setApiUnavailable(true);

      // Fetch cataloged event types as a proxy for "events arrived"
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

  // Update seconds-since counter
  useEffect(() => {
    const id = setInterval(() => {
      if (lastChecked) {
        setSecondsSince(Math.floor((Date.now() - lastChecked) / 1000));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [lastChecked]);

  useScreenInput((_char, key) => {
    if (celebrating) return; // don't interrupt celebration
    if (key.escape || _char === 'q') {
      if (pollingRef.current !== null) clearInterval(pollingRef.current);
      store.setOutroData({
        kind: OutroKind.Cancel,
        message:
          'Come back once your app is running and sending events. Your SDK is installed — just trigger some actions.',
      });
      return;
    }
    // Manual confirmation when API is unavailable
    if (apiUnavailable && key.return) {
      if (pollingRef.current !== null) clearInterval(pollingRef.current);
      store.setDataIngestionConfirmed();
    }
  });

  // Derive framework-specific hint
  const frameworkHint = session.integration
    ? FRAMEWORK_HINTS[session.integration]
    : undefined;

  const shown = eventTypes?.slice(0, MAX_EVENTS_SHOWN) ?? [];
  const overflow = (eventTypes?.length ?? 0) - MAX_EVENTS_SHOWN;

  // ── Celebration state ──────────────────────────────────────────────────

  if (celebrating) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
        <Text bold color={Colors.success}>
          {Icons.checkmark} Events detected!
        </Text>
        {arrivedEvents.length > 0 && (
          <Box flexDirection="column" marginTop={1} marginLeft={2}>
            {arrivedEvents.slice(0, MAX_EVENTS_SHOWN).map((name) => (
              <Text key={name} color={Colors.success}>
                {Icons.diamond} {name}
              </Text>
            ))}
            {arrivedEvents.length > MAX_EVENTS_SHOWN && (
              <Text color={Colors.muted}>
                {Icons.ellipsis} and {arrivedEvents.length - MAX_EVENTS_SHOWN}{' '}
                more
              </Text>
            )}
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={Colors.body}>Continuing{Icons.ellipsis}</Text>
        </Box>
      </Box>
    );
  }

  // ── Waiting state ──────────────────────────────────────────────────────

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
      {/* Primary instruction */}
      <Box marginBottom={1}>
        <Text bold color={Colors.heading}>
          Start your app and trigger some user actions
        </Text>
      </Box>

      {/* Framework-specific hint */}
      {frameworkHint && (
        <Box marginBottom={1}>
          <Text color={Colors.accent}>
            {Icons.arrowRight} {frameworkHint}
          </Text>
        </Box>
      )}

      <Text color={Colors.body}>
        Your SDK is installed. Once you interact with your app, events will
        start flowing into Amplitude.
      </Text>

      {/* Spinner / polling indicator */}
      {!apiUnavailable && (
        <Box marginTop={1} gap={1} alignItems="center">
          <BrailleSpinner color={Colors.accent} />
          <Text color={Colors.secondary}>
            Listening for events{Icons.ellipsis}
            {lastChecked && (
              <Text color={Colors.muted}> (checked {secondsSince}s ago)</Text>
            )}
          </Text>
        </Box>
      )}

      {/* API unavailable: checking catalog */}
      {apiUnavailable && eventTypes === null && (
        <Box marginTop={1} gap={1} alignItems="center">
          <BrailleSpinner color={Colors.accent} />
          <Text color={Colors.secondary}>
            Checking your event catalog{Icons.ellipsis}
          </Text>
        </Box>
      )}

      {/* API unavailable: show cataloged events */}
      {apiUnavailable && eventTypes !== null && eventTypes.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={Colors.secondary}>
            Events cataloged in your workspace:
          </Text>
          <Box flexDirection="column" marginTop={1} marginLeft={2}>
            {shown.map((name) => (
              <Box key={name} gap={1}>
                <Text color={Colors.success}>{Icons.diamond}</Text>
                <Text color={Colors.body}>{name}</Text>
              </Box>
            ))}
            {overflow > 0 && (
              <Text color={Colors.muted}>
                {Icons.ellipsis} and {overflow} more
              </Text>
            )}
          </Box>
        </Box>
      )}

      {/* API unavailable: no events yet */}
      {apiUnavailable && eventTypes !== null && eventTypes.length === 0 && (
        <Box marginTop={1} gap={1} alignItems="center">
          <BrailleSpinner color={Colors.accent} />
          <Text color={Colors.secondary}>
            Waiting for events{Icons.ellipsis}
          </Text>
        </Box>
      )}

      {/* Key hints — unified bracket format */}
      <Box marginTop={2} gap={2}>
        {apiUnavailable && (
          <Box>
            <Text color={Colors.muted}>[</Text>
            <Text color={Colors.body} bold>
              Enter
            </Text>
            <Text color={Colors.muted}>
              ] {eventTypes && eventTypes.length > 0 ? 'Continue' : 'Confirm'}
            </Text>
          </Box>
        )}
        <Box>
          <Text color={Colors.muted}>[</Text>
          <Text color={Colors.body} bold>
            q
          </Text>
          <Text color={Colors.muted}>] Exit and resume later</Text>
        </Box>
      </Box>
    </Box>
  );
};
