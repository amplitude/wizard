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
  fetchAmplitudeUser,
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
  const [resolvedOrgName, setResolvedOrgName] = useState<string | null>(
    store.session.selectedOrgName,
  );

  const region = store.session.region ?? 'us';
  const isEu = region === 'eu';
  const appName = isEu ? 'Amplitude - EU' : 'Amplitude';

  // Fetch org name and check if Slack is already connected on mount.
  useEffect(() => {
    const credentials = store.session.credentials;
    const token = credentials?.idToken ?? credentials?.accessToken;
    const orgId = store.session.selectedOrgId;

    logToFile(
      `[SlackScreen] selectedOrgName=${
        store.session.selectedOrgName ?? ''
      } credentials=${credentials ? 'present' : 'null'} region=${region}`,
    );

    // Resolve org name if missing (returning users, standalone /slack command).
    if (!resolvedOrgName && credentials) {
      logToFile(`[SlackScreen] fetching org name via API`);
      void fetchAmplitudeUser(token!, region as AmplitudeZone)
        .then((info) => {
          const name = info.orgs[0]?.name ?? null;
          logToFile(
            `[SlackScreen] API returned orgs=${JSON.stringify(
              info.orgs.map((o) => o.name),
            )} using=${name}`,
          );
          setResolvedOrgName(name);
        })
        .catch((err: unknown) => {
          logToFile(
            `[SlackScreen] API fetch failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
    }

    // Check if Slack is already connected — auto-complete if so.
    if (token && orgId) {
      void fetchSlackConnectionStatus(
        token,
        region as AmplitudeZone,
        orgId,
      ).then((isConnected) => {
        logToFile(`[SlackScreen] slackConnectionStatus=${isConnected}`);
        if (isConnected) {
          setPhase(Phase.Done);
          setTimeout(
            () =>
              markDone(store, SlackOutcome.Configured, standalone, onComplete),
            1500,
          );
        }
      });
    }
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
    const token = credentials?.idToken ?? credentials?.accessToken;

    if (token && orgId) {
      void fetchSlackInstallUrl(token, zone, orgId, settingsUrl).then(
        (directUrl) => {
          const urlToOpen = directUrl ?? settingsUrl;
          setOpenedUrl(urlToOpen);
          logToFile(
            `[SlackScreen] opening ${
              directUrl ? 'direct Slack OAuth URL' : 'settings fallback'
            }`,
          );
          opn(urlToOpen, { wait: false }).catch(() => {});
          setTimeout(() => setPhase(Phase.Waiting), 800);
        },
      );
    } else {
      logToFile(`[SlackScreen] no token/orgId — opening settings fallback`);
      opn(settingsUrl, { wait: false }).catch(() => {});
      setTimeout(() => setPhase(Phase.Waiting), 800);
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
