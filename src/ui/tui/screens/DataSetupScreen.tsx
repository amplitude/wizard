/**
 * DataSetupScreen — Checks whether the connected Amplitude project has event data.
 *
 * Calls the Amplitude Data API to determine the project's activation level:
 *   'full'    — 50+ events / well-established data → Options menu
 *   'partial' — snippet installed but few events   → ActivationOptions screen
 *   'none'    — no events, no snippet              → Framework Detection
 *
 * The router's isComplete predicate (projectHasData !== null) advances past
 * this screen automatically once the value is set.
 */

import { Box } from 'ink';
import { useEffect, useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { LoadingBox } from '../primitives/index.js';
import { fetchProjectActivationStatus } from '../../../lib/api.js';
import { detectAmplitudeInProject } from '../../../lib/detect-amplitude.js';
import type { AmplitudeZone } from '../../../lib/constants.js';
import { logToFile } from '../../../utils/debug.js';

interface DataSetupScreenProps {
  store: WizardStore;
}

export const DataSetupScreen = ({ store }: DataSetupScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  useEffect(() => {
    if (store.session.projectHasData !== null) return;

    const { credentials, region, selectedOrgId, selectedWorkspaceId } =
      store.session;
    // credentials.projectId is 0 for OAuth users; fall back to the workspace UUID
    const appId =
      store.session.credentials?.projectId || selectedWorkspaceId || null;

    // No credentials or project ID — can't check, fall through to Framework Detection
    if (!credentials || !appId || !selectedOrgId) {
      logToFile('[DataSetup] no credentials/appId — skipping activation check');
      store.setActivationLevel('none');
      return;
    }

    const zone = (region ?? 'us') as AmplitudeZone;
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

    // Thunder uses access_token (Hydra-validated), not id_token.
    void fetchProjectActivationStatus(
      credentials.accessToken,
      zone,
      appId,
      selectedOrgId,
      credentials.idToken ?? credentials.accessToken,
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
      <LoadingBox message="Checking project setup…" />
    </Box>
  );
};
