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
import { useEffect } from 'react';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { Colors, Icons } from '../styles.js';
import { BrailleSpinner } from '../components/BrailleSpinner.js';
import { fetchProjectActivationStatus } from '../../../lib/api.js';
import { DEFAULT_AMPLITUDE_ZONE } from '../../../lib/constants.js';
import { detectAmplitudeInProject } from '../../../lib/detect-amplitude.js';
import { resolveZone } from '../../../lib/zone-resolution.js';
import { logToFile } from '../../../utils/debug.js';

interface DataSetupScreenProps {
  store: WizardStore;
}

export const DataSetupScreen = ({ store }: DataSetupScreenProps) => {
  useWizardStore(store);

  useEffect(() => {
    if (store.session.projectHasData !== null) return;

    const { credentials, selectedOrgId, selectedProjectId } = store.session;
    // credentials.appId is 0 for OAuth users; fall back to the project UUID
    const appId = store.session.credentials?.appId || selectedProjectId || null;

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

    void fetchProjectActivationStatus({
      accessToken: credentials.accessToken,
      zone,
      appId,
      orgId: selectedOrgId,
    })
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
        logToFile(
          `[DataSetup] activation check failed: ${
            err instanceof Error ? err.message : String(err)
          } — falling back to local detection`,
        );
        // If the API fails, use local detection as a fallback.
        store.setActivationLevel(
          localDetection.confidence !== 'none' ? 'partial' : 'none',
        );
      });
  }, []);

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
