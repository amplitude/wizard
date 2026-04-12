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
import { Colors, Icons } from '../styles.js';
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

    // Try the direct Slack OAuth URL first; fall back to settings page.
    const open = (url: string) => {
      setOpenedUrl(url);
      logToFile(
        `[SlackScreen] opening ${
          url === settingsUrl ? 'settings fallback' : 'direct Slack OAuth URL'
        }`,
      );
      opn(url, { wait: false }).catch(() => {});
      setTimeout(() => setPhase(Phase.Waiting), 800);
    };

    if (accessToken && orgId) {
      void fetchSlackInstallUrl(accessToken, zone, orgId, settingsUrl).then(
        (directUrl) => open(directUrl ?? settingsUrl),
      );
    } else {
      open(settingsUrl);
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
              message={`Connect the "${appName}" Slack app to your workspace?`}
              confirmLabel="Connect"
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
            {openedUrl === settingsUrl ? (
              <>
                <Text>
                  Browser opened to <Text color="cyan">{settingsUrl}</Text>
                </Text>
                <Text color={Colors.muted}>
                  Go to Settings &gt; Personal Settings &gt; Profile and click
                  &quot;Connect to Slack&quot;.
                </Text>
                <Text color={Colors.muted}>
                  Docs: <Text color="cyan">https://amplitude.com/docs/analytics/integrate-slack</Text>
                </Text>
              </>
            ) : (
              <>
                <Text>
                  Browser opened to <Text color="cyan">Slack</Text> for
                  authorization.
                </Text>
                <Text color={Colors.muted}>
                  Authorize the {appName} app in Slack to complete the
                  connection.
                </Text>
                <Text color={Colors.muted}>
                  Docs: <Text color="cyan">https://amplitude.com/docs/analytics/integrate-slack</Text>
                </Text>
              </>
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
              {Icons.check} Slack connected! You&apos;ll get chart previews and
              notifications in Slack.
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};
