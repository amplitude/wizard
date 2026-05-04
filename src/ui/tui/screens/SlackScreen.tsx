/**
 * SlackScreen — Amplitude Slack integration setup (v2).
 *
 * Guides the user to connect their Slack workspace to Amplitude.
 * Since the OAuth handshake happens in the browser (Amplitude Settings),
 * this screen opens the right settings URL and lets the user confirm
 * once connected or skip.
 *
 * Region-aware: EU users need the "Amplitude - EU" Slack app.
 */

import { Box, Text } from 'ink';
import { useState, useEffect, useRef } from 'react';
import type { WizardStore } from '../store.js';
import { SlackOutcome } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { useEscapeBack } from '../hooks/useEscapeBack.js';
import { ConfirmationInput, TerminalLink } from '../primitives/index.js';
import { Colors, Icons } from '../styles.js';
import {
  fetchSlackInstallUrl,
  fetchSlackConnectionStatus,
} from '../../../lib/api.js';
import { OUTBOUND_URLS } from '../../../lib/constants.js';
import { useResolvedZone } from '../hooks/useResolvedZone.js';
import { logToFile } from '../../../utils/debug.js';
import { wizardSuccessExit } from '../../../utils/wizard-abort.js';
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
  Verifying = 'verifying',
  NotConnected = 'notConnected',
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
      // Standalone /slack slash-command run — flush analytics
      // (the just-fired 'Slack Setup Complete' event) before the
      // process exits.
      void wizardSuccessExit(0);
    }
  }
};

export const SlackScreen = ({
  store,
  standalone = false,
  onComplete,
}: SlackScreenProps) => {
  useWizardStore(store);

  const [phase, setPhase] = useState<Phase>(Phase.Prompt);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  // ConfirmationInput: Esc → router back when possible (onEscape); focused
  // cancel row + Enter skips Slack (onCancel). Elsewhere (Opening / Verifying,
  // Done) Esc → goBack when the router allows it.
  const confirmationInputPhase =
    phase === Phase.Prompt ||
    phase === Phase.Waiting ||
    phase === Phase.NotConnected;
  useEscapeBack(store, {
    enabled:
      !standalone &&
      onComplete === undefined &&
      !confirmationInputPhase,
  });

  // Clear any pending timer on unmount and flag as unmounted so late-resolving
  // async work won't schedule new timers or call markDone.
  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const region = useResolvedZone(store.session);
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

    // The App API uses access_token, not id_token.
    const accessToken = credentials?.accessToken;
    if (accessToken && orgId) {
      void fetchSlackConnectionStatus(accessToken, region, orgId).then(
        (isConnected) => {
          if (cancelled || unmountedRef.current) return;
          logToFile(`[SlackScreen] slackConnectionStatus=${isConnected}`);
          if (isConnected) {
            setPhase(Phase.Done);
            timerRef.current = setTimeout(() => {
              if (!cancelled && !unmountedRef.current) {
                markDone(
                  store,
                  SlackOutcome.Configured,
                  standalone,
                  onComplete,
                );
              }
            }, 1500);
          }
        },
      );
    }

    return () => {
      cancelled = true;
    };
  }, []);

  const settingsUrl = OUTBOUND_URLS.slackSettings(
    region,
    store.session.selectedOrgId,
  );

  const [openedUrl, setOpenedUrl] = useState(settingsUrl);

  const handleConnect = () => {
    setPhase(Phase.Opening);

    const credentials = store.session.credentials;
    const orgId = store.session.selectedOrgId;
    // The App API uses access_token, not id_token.
    const accessToken = credentials?.accessToken;

    // Try the direct Slack OAuth URL first; fall back to settings page.
    const open = (url: string) => {
      if (unmountedRef.current) return;
      setOpenedUrl(url);
      logToFile(
        `[SlackScreen] opening ${
          url === settingsUrl ? 'settings fallback' : 'direct Slack OAuth URL'
        }`,
      );
      opn(url, { wait: false }).catch(() => {});
      timerRef.current = setTimeout(() => setPhase(Phase.Waiting), 800);
    };

    if (accessToken && orgId) {
      void fetchSlackInstallUrl(accessToken, region, orgId, settingsUrl).then(
        (directUrl) => open(directUrl ?? settingsUrl),
      );
    } else {
      open(settingsUrl);
    }
  };

  const handleSkip = () => {
    markDone(store, SlackOutcome.Skipped, standalone, onComplete);
  };

  /** Esc on confirm prompts: step back when possible; otherwise skip Slack. */
  const escCancelOrRouterBack = () => {
    if (store.canGoBack()) {
      store.goBack();
    } else {
      handleSkip();
    }
  };

  const handleDone = () => {
    // Don't trust the user's "yes" — re-verify against the App API. The
    // OAuth handshake can silently fail (closed tab, denied consent, popup
    // blocker) and we'd otherwise celebrate a connection that doesn't
    // exist.
    const credentials = store.session.credentials;
    const orgId = store.session.selectedOrgId;
    const accessToken = credentials?.accessToken;

    if (!accessToken || !orgId) {
      // No way to verify — fall back to trusting the user. This matches
      // the pre-existing behavior for unauthenticated/standalone runs.
      setPhase(Phase.Done);
      timerRef.current = setTimeout(
        () => markDone(store, SlackOutcome.Configured, standalone, onComplete),
        1500,
      );
      return;
    }

    setPhase(Phase.Verifying);
    void fetchSlackConnectionStatus(accessToken, region, orgId).then(
      (isConnected) => {
        if (unmountedRef.current) return;
        logToFile(
          `[SlackScreen] post-confirm slackConnectionStatus=${isConnected}`,
        );
        if (isConnected) {
          setPhase(Phase.Done);
          timerRef.current = setTimeout(
            () =>
              markDone(store, SlackOutcome.Configured, standalone, onComplete),
            1500,
          );
        } else {
          setPhase(Phase.NotConnected);
        }
      },
    );
  };

  const handleRetry = () => {
    // User wants another shot — re-open the auth URL and go back to
    // Waiting so they can confirm again.
    handleConnect();
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={Colors.accent}>
        Slack Integration
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text color={Colors.secondary}>
          Connect Amplitude to Slack for chart previews, dashboard sharing,
        </Text>
        <Text color={Colors.secondary}>
          and real-time tracking plan notifications.
        </Text>

        {isEu && (
          <Box marginTop={1}>
            <Text color={Colors.warning}>
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
              onEscape={escCancelOrRouterBack}
            />
          </Box>
        )}

        {phase === Phase.Opening && (
          <Text color={Colors.active}>Opening browser{Icons.ellipsis}</Text>
        )}

        {phase === Phase.Waiting && (
          <Box flexDirection="column" marginTop={1}>
            {openedUrl === settingsUrl ? (
              <>
                <Text color={Colors.body}>
                  Browser opened to{' '}
                  <TerminalLink url={settingsUrl}>{settingsUrl}</TerminalLink>
                </Text>
                <Text color={Colors.secondary}>
                  Go to Settings {Icons.chevronRight} Personal Settings{' '}
                  {Icons.chevronRight} Profile and click &quot;Connect to
                  Slack&quot;.
                </Text>
                <Text color={Colors.muted}>
                  Docs:{' '}
                  <TerminalLink url="https://amplitude.com/docs/analytics/integrate-slack" />
                </Text>
              </>
            ) : (
              <>
                <Text color={Colors.body}>
                  Browser opened to <Text color={Colors.accent}>Slack</Text> for
                  authorization.
                </Text>
                <Text color={Colors.secondary}>
                  Authorize the {appName} app in Slack to complete the
                  connection.
                </Text>
                <Text color={Colors.muted}>
                  Docs:{' '}
                  <TerminalLink url="https://amplitude.com/docs/analytics/integrate-slack" />
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
                onEscape={escCancelOrRouterBack}
              />
            </Box>
          </Box>
        )}

        {phase === Phase.Verifying && (
          <Box marginTop={1}>
            <Text color={Colors.active}>
              Checking your Slack connection{Icons.ellipsis}
            </Text>
          </Box>
        )}

        {phase === Phase.NotConnected && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={Colors.warning}>
              We don&apos;t see the Slack connection yet. Make sure you finished
              authorizing the {appName} app in your browser.
            </Text>
            <Box marginTop={1}>
              <ConfirmationInput
                message="Try again?"
                confirmLabel="Retry"
                cancelLabel="Skip anyway"
                onConfirm={handleRetry}
                onCancel={handleSkip}
                onEscape={escCancelOrRouterBack}
              />
            </Box>
          </Box>
        )}

        {phase === Phase.Done && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={Colors.success} bold>
              {Icons.checkmark} Slack connected! You&apos;ll get chart previews
              and notifications in Slack.
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};
