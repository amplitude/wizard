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
import { getCloudUrlFromRegion } from '../../../utils/urls.js';
import { fetchAmplitudeUser } from '../../../lib/api.js';
import type { AmplitudeZone } from '../../../lib/constants.js';
import { logToFile } from '../../../utils/debug.js';
import opn from 'opn';

interface SlackScreenProps {
  store: WizardStore;
  /** When true, exit the process after completion instead of routing to outro. */
  standalone?: boolean;
}

enum Phase {
  Prompt = 'prompt',
  Opening = 'opening',
  Waiting = 'waiting',
  Done = 'done',
}

/**
 * Build the Amplitude settings URL for Slack connection.
 * Uses the org name from the API; falls back to base URL.
 */
export function slackSettingsUrl(baseUrl: string, orgName: string | null): string {
  if (orgName) {
    return `${baseUrl}/analytics/${encodeURIComponent(orgName)}/settings/profile`;
  }
  return `${baseUrl}/settings/profile`;
}

const markDone = (
  store: WizardStore,
  outcome: SlackOutcome,
  standalone: boolean,
) => {
  store.setSlackComplete(outcome);
  if (standalone) {
    process.exit(0);
  }
};

export const SlackScreen = ({
  store,
  standalone = false,
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

  // Fetch org name from the API if it wasn't populated during the SUSI flow
  // (e.g. returning users, or the standalone `slack` command).
  useEffect(() => {
    logToFile(`[SlackScreen] selectedOrgName=${store.session.selectedOrgName} credentials=${store.session.credentials ? 'present' : 'null'} region=${region}`);
    if (resolvedOrgName) {
      logToFile(`[SlackScreen] using existing orgName=${resolvedOrgName}`);
      return;
    }
    const credentials = store.session.credentials;
    if (!credentials) {
      logToFile(`[SlackScreen] no credentials — falling back to base URL`);
      return;
    }
    logToFile(`[SlackScreen] fetching org name via API`);
    void fetchAmplitudeUser(credentials.accessToken, region as AmplitudeZone)
      .then((info) => {
        const name = info.orgs[0]?.name ?? null;
        logToFile(`[SlackScreen] API returned orgs=${JSON.stringify(info.orgs.map(o => o.name))} using=${name}`);
        setResolvedOrgName(name);
      })
      .catch((err: unknown) => {
        logToFile(`[SlackScreen] API fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, []); // eslint-disable-line

  const settingsUrl = slackSettingsUrl(
    getCloudUrlFromRegion(region),
    resolvedOrgName,
  );

  const handleConnect = () => {
    setPhase(Phase.Opening);
    opn(settingsUrl, { wait: false }).catch(() => {});
    setTimeout(() => setPhase(Phase.Waiting), 800);
  };

  const handleSkip = () => {
    markDone(store, SlackOutcome.Skipped, standalone);
  };

  const handleDone = () => {
    setPhase(Phase.Done);
    setTimeout(() => markDone(store, SlackOutcome.Configured, standalone), 1500);
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={Colors.accent}>
        Slack Integration
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          Connect Amplitude to Slack for chart previews, dashboard sharing,
        </Text>
        <Text dimColor>and real-time tracking plan notifications.</Text>

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
          <Text dimColor>Opening browser...</Text>
        )}

        {phase === Phase.Waiting && (
          <Box flexDirection="column" marginTop={1}>
            <Text>
              Browser opened to{' '}
              <Text color="cyan">{settingsUrl}</Text>
            </Text>
            <Text dimColor>
              Go to Settings &gt; Personal Settings &gt; Profile and click
              &quot;Connect to Slack&quot;.
            </Text>
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
