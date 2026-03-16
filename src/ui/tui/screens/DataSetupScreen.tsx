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

    const { credentials, region, selectedOrgId } = store.session;
    const appId = store.session.credentials?.projectId;

    // No credentials or project ID — can't check, fall through to Framework Detection
    if (!credentials || !appId || !selectedOrgId) {
      logToFile('[DataSetup] no credentials/appId — skipping activation check');
      store.setActivationLevel('none');
      return;
    }

    const zone = (region ?? 'us') as AmplitudeZone;
    logToFile(`[DataSetup] checking activation for appId=${appId} zone=${zone}`);

    void fetchProjectActivationStatus(credentials.accessToken, zone, appId)
      .then((status) => {
        logToFile(`[DataSetup] activation status: ${JSON.stringify(status)}`);
        store.setSnippetConfigured(status.hasDetSource);

        if (status.hasAnyEvents && status.hasDetSource) {
          // Has both SDK and events — treat as partial (wizard will prompt next steps)
          // Use a heuristic: if all three core event types are present, call it full
          const isFull = status.hasPageViewedEvent && status.hasSessionStartEvent && status.hasSessionEndEvent;
          store.setActivationLevel(isFull ? 'full' : 'partial');
        } else if (status.hasDetSource) {
          // SDK installed but no events yet
          store.setActivationLevel('partial');
        } else {
          // No SDK, no events
          store.setActivationLevel('none');
        }
      })
      .catch((err: unknown) => {
        logToFile(`[DataSetup] activation check failed: ${err instanceof Error ? err.message : String(err)} — falling back to none`);
        store.setActivationLevel('none');
      });
  }, []);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <LoadingBox message="Checking project setup…" />
    </Box>
  );
};
