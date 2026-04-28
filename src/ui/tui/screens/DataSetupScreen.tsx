/**
 * DataSetupScreen — Checks whether the connected Amplitude project has event data.
 *
 * Calls the Amplitude Data API to determine the project's activation level:
 *   'full'    — 50+ events / well-established data
 *   'partial' — snippet installed but few events
 *   'none'    — no events, no snippet
 *
 * The router's isComplete predicate (projectHasData !== null) advances past
 * this screen automatically once the value is set.
 */

import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { useEscapeBack } from '../hooks/useEscapeBack.js';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { Colors, Icons } from '../styles.js';
import { BrailleSpinner } from '../components/BrailleSpinner.js';
import { fetchProjectActivationStatus } from '../../../lib/api.js';
import { DEFAULT_AMPLITUDE_ZONE } from '../../../lib/constants.js';
import { detectAmplitudeInProject } from '../../../lib/detect-amplitude.js';
import { resolveZone } from '../../../lib/zone-resolution.js';
import { withTimeout } from '../utils/with-timeout.js';
import { logToFile } from '../../../utils/debug.js';

const ACTIVATION_FETCH_TIMEOUT_MS = 30_000;

interface DataSetupScreenProps {
  store: WizardStore;
}

export const DataSetupScreen = ({ store }: DataSetupScreenProps) => {
  useWizardStore(store);
  // Esc → back to Auth's org/project picker. The activation API call is
  // idempotent so backing out mid-flight is safe.
  useEscapeBack(store);

  // Surfaces the timeout fallback prompt — "Couldn't reach Amplitude;
  // continue anyway?" — when the activation fetch hangs past 30s. This
  // matters because a hung proxy with no response would otherwise leave
  // the spinner ticking forever.
  const [timedOut, setTimedOut] = useState(false);

  useScreenInput(
    (input) => {
      if (!timedOut) return;
      if (input.toLowerCase() === 'y') {
        // User wants to continue without confirmed activation status.
        // Fall through with 'none' so the framework-detection flow runs.
        store.setActivationLevel('none');
      }
    },
    { isActive: timedOut },
  );

  useEffect(() => {
    if (store.session.projectHasData !== null) return;

    const { credentials, selectedOrgId, selectedWorkspaceId } = store.session;
    // credentials.appId is 0 for OAuth users; fall back to the workspace UUID
    const appId =
      store.session.credentials?.appId || selectedWorkspaceId || null;

    // No credentials or project ID — can't check, fall through to Framework Detection
    if (!credentials || !appId || !selectedOrgId) {
      logToFile('[DataSetup] no credentials/appId — skipping activation check');
      store.setActivationLevel('none');
      return;
    }

    // readDisk: false — region is populated on the session by the time this
    // screen renders (flow is gated on region !== null). Skipping Tier 2/3
    // avoids synchronous readAmpliConfig + getStoredUser disk reads on mount.
    const zone = resolveZone(store.session, DEFAULT_AMPLITUDE_ZONE, {
      readDisk: false,
    });
    logToFile(
      `[DataSetup] checking activation for appId=${appId} zone=${zone}`,
    );

    // Run local static check in parallel with the API call.
    const localDetection = detectAmplitudeInProject(store.session.installDir);
    logToFile(
      `[DataSetup] local detection: confidence=${
        localDetection.confidence
      } reason=${localDetection.reason ?? 'none'}`,
    );

    void withTimeout(
      fetchProjectActivationStatus({
        accessToken: credentials.accessToken,
        zone,
        appId,
        orgId: selectedOrgId,
      }),
      ACTIVATION_FETCH_TIMEOUT_MS,
      'fetchProjectActivationStatus',
    )
      .then((status) => {
        logToFile(`[DataSetup] activation status: ${JSON.stringify(status)}`);
        store.setSnippetConfigured(status.hasDetSource);

        if (status.hasAnyEvents && status.hasDetSource) {
          // Has both SDK and events — use a heuristic: if all three core event types
          // are present, call it full.
          const isFull =
            status.hasPageViewedEvent &&
            status.hasSessionStartEvent &&
            status.hasSessionEndEvent;
          store.setActivationLevel(isFull ? 'full' : 'partial');
        } else if (status.hasDetSource) {
          // SDK installed but no events yet
          store.setActivationLevel('partial');
        } else if (localDetection.confidence !== 'none') {
          // API sees no SDK, but local files suggest Amplitude is already installed.
          // Treat as partial so the wizard asks what they need rather than running
          // the full install agent.
          logToFile(
            `[DataSetup] upgrading to partial via local detection: ${localDetection.reason}`,
          );
          store.setActivationLevel('partial');
        } else {
          // No SDK, no events, no local evidence — full install needed
          store.setActivationLevel('none');
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        const isTimeout = err instanceof Error && err.name === 'TimeoutError';
        logToFile(
          `[DataSetup] activation check failed: ${message}${
            isTimeout ? ' (timeout)' : ''
          } — ${
            isTimeout
              ? 'awaiting user decision'
              : 'falling back to local detection'
          }`,
        );
        if (isTimeout) {
          // Surface the manual fallback prompt and let the user decide.
          // Local detection alone isn't strong enough signal to silently
          // commit a path — the user knows whether their network is the
          // problem and we should ask.
          setTimedOut(true);
          return;
        }
        // Other errors: use local detection as a fallback.
        store.setActivationLevel(
          localDetection.confidence !== 'none' ? 'partial' : 'none',
        );
      });
  }, []);

  if (timedOut) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Box flexDirection="column">
          <Text bold color={Colors.heading}>
            Checking project setup
          </Text>
          <Box marginTop={1}>
            <Text color={Colors.warning}>
              Couldn&apos;t reach Amplitude after 30s. Network or proxy issue?
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color={Colors.body}>
              Continue anyway? We&apos;ll skip the activation check and run full
              setup.
            </Text>
          </Box>
          <Box marginTop={1} gap={2}>
            <Box>
              <Text color={Colors.muted}>[</Text>
              <Text bold color={Colors.body}>
                Y
              </Text>
              <Text color={Colors.muted}>] Yes, continue</Text>
            </Box>
            <Box>
              <Text color={Colors.muted}>[</Text>
              <Text bold color={Colors.body}>
                Esc
              </Text>
              <Text color={Colors.muted}>] Cancel and go back</Text>
            </Box>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column">
        <Text bold color={Colors.heading}>
          Checking project setup
        </Text>
        <Box marginTop={1} gap={1}>
          <BrailleSpinner color={Colors.accent} />
          <Text color={Colors.body}>
            Analyzing your Amplitude project{Icons.ellipsis}
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text color={Colors.muted}>
            Looking for existing SDK installation and event data
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
