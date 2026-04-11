/**
 * SlackScreen — Amplitude Slack integration setup.
 *
 * Guides the user to connect their Slack workspace to Amplitude.
 * Since the OAuth handshake happens in the browser (Amplitude Settings),
 * this screen opens the right settings URL and lets the user confirm
 * once connected or skip.
 *
 * Region-aware: EU users need the "Amplitude - EU" Slack app.
 */

import { Box, Text } from 'ink';
import { useState, useEffect } from 'react';
import { useSyncExternalStore } from 'react';
import { type WizardStore, SlackOutcome } from '../store.js';
import { ConfirmationInput } from '../primitives/index.js';
import { Colors } from '../styles.js';
import {
  fetchSlackInstallUrl,
  fetchSlackConnectionStatus,
} from '../../../lib/api.js';
import { OUTBOUND_URLS, type AmplitudeZone } from '../../../lib/constants.js';
import { logToFile } from '../../../utils/debug.js';
import opn from 'opn';

interface SlackScreenProps {
  store: WizardStore;
  /** When true, exit the process after completion instead of routing to outro. */
  standalone?: boolean;
  /** When provided, called on completion instead of setSlackComplete (overlay mode). */
  onComplete?: () => void;
}

enum Phase {
  Prompt = 'prompt',
  Opening = 'opening',
  Waiting = 'waiting',
  Done = 'done',
}

const markDone = (
  store: WizardStore,
  outcome: SlackOutcome,
  standalone: boolean,
  onComplete?: () => void,
) => {
  if (onComplete) {
    onComplete();
  } else {
    store.setSlackComplete(outcome);
    if (standalone) {
      process.exit(0);
    }
  }
};

export const SlackScreen = ({
  store,
  standalone = false,
  onComplete,
}: SlackScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [phase, setPhase] = useState<Phase>(Phase.Prompt);

  const region = store.session.region ?? 'us';
  const isEu = region === 'eu';
  const appName = isEu ? 'Amplitude - EU' : 'Amplitude';

  // Check if Slack is already connected on mount — auto-complete if so.
  useEffect(() => {
    let cancelled = false;

    const credentials = store.session.credentials;
    const orgId = store.session.selectedOrgId;

    logToFile(
      `[SlackScreen] selectedOrgName=${
        store.session.selectedOrgName ?? ''
      } credentials=${credentials ? 'present' : 'null'} region=${region}`,
    );

    // Thunder uses access_token (Hydra-validated), not id_token.
    const accessToken = credentials?.accessToken;
    if (accessToken && orgId) {
      void fetchSlackConnectionStatus(
        accessToken,
        region as AmplitudeZone,
        orgId,
      ).then((isConnected) => {
        if (cancelled) return;
        logToFile(`[SlackScreen] slackConnectionStatus=${isConnected}`);
        if (isConnected) {
          setPhase(Phase.Done);
          setTimeout(() => {
            if (!cancelled) {
              markDone(store, SlackOutcome.Configured, standalone, onComplete);
            }
          }, 1500);
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, []);

  const zone = (region ?? 'us') as AmplitudeZone;

  const settingsUrl = OUTBOUND_URLS.slackSettings(
    zone,
    store.session.selectedOrgId,
  );

  const [openedUrl, setOpenedUrl] = useState(settingsUrl);

  const handleConnect = () => {
    setPhase(Phase.Opening);

    const credentials = store.session.credentials;
    const orgId = store.session.selectedOrgId;
    // Thunder uses access_token (Hydra-validated), not id_token.
    const accessToken = credentials?.accessToken;

    // Open the settings URL immediately so the user sees browser activity.
    logToFile(`[SlackScreen] opening settings URL`);
    opn(settingsUrl, { wait: false }).catch(() => {});
    setTimeout(() => setPhase(Phase.Waiting), 800);

    // In parallel, attempt to fetch a direct Slack OAuth URL.
    // If available, open it as an upgrade (user gets both tabs — settings
    // as fallback, direct OAuth as primary).
    if (accessToken && orgId) {
      void fetchSlackInstallUrl(accessToken, zone, orgId, settingsUrl).then(
        (directUrl) => {
          if (directUrl) {
            setOpenedUrl(directUrl);
            logToFile(`[SlackScreen] opening direct Slack OAuth URL`);
            opn(directUrl, { wait: false }).catch(() => {});
          }
        },
      );
    }
  };

  const handleSkip = () => {
    markDone(store, SlackOutcome.Skipped, standalone, onComplete);
  };

  const handleDone = () => {
    setPhase(Phase.Done);
    setTimeout(
      () => markDone(store, SlackOutcome.Configured, standalone, onComplete),
      1500,
    );
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={Colors.accent}>
        Slack Integration
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text color={Colors.muted}>
          Connect Amplitude to Slack for chart previews, dashboard sharing,
        </Text>
        <Text color={Colors.muted}>
          and real-time tracking plan notifications.
        </Text>

        {isEu && (
          <Box marginTop={1}>
            <Text color="yellow">
              EU region: install the &quot;Amplitude - EU&quot; app from the
              Slack App Directory.
            </Text>
          </Box>
        )}

        {phase === Phase.Prompt && (
          <Box marginTop={1}>
            <ConfirmationInput
              message={`Open Amplitude Settings to connect the "${appName}" Slack app?`}
              confirmLabel="Open settings"
              cancelLabel="Skip for now"
              onConfirm={handleConnect}
              onCancel={handleSkip}
            />
          </Box>
        )}

        {phase === Phase.Opening && (
          <Text color={Colors.muted}>Opening browser...</Text>
        )}

        {phase === Phase.Waiting && (
          <Box flexDirection="column" marginTop={1}>
            <Text>
              Browser opened to <Text color="cyan">{openedUrl}</Text>
            </Text>
            {openedUrl === settingsUrl && (
              <Text color={Colors.muted}>
                Go to Settings &gt; Personal Settings &gt; Profile and click
                &quot;Connect to Slack&quot;.
              </Text>
            )}
            {openedUrl !== settingsUrl && (
              <Text color={Colors.muted}>
                Authorize the {appName} app in Slack to complete the connection.
              </Text>
            )}
            <Box marginTop={1}>
              <ConfirmationInput
                message="Connected to Slack?"
                confirmLabel="Yes, connected"
                cancelLabel="Skip for now"
                onConfirm={handleDone}
                onCancel={handleSkip}
              />
            </Box>
          </Box>
        )}

        {phase === Phase.Done && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="green" bold>
              {'\u2714'} Slack connected! You&apos;ll get chart previews and
              notifications in Slack.
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};
