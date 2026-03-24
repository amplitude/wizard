/**
 * ConsoleView — Full-screen bordered box.
 *
 * Renders arbitrary children in the content area, with a persistent
 * slash-command / Claude-query input at the bottom.
 *
 * The input is dormant by default. Activation:
 *   - "/" → activate in slash-command mode
 *   - Tab → activate for free-text Claude query
 * Deactivation: Enter (submit) or Escape. Backspacing to empty also deactivates.
 *
 * While active, commandMode=true on the store disables all useScreenInput handlers.
 */

import { Box, Text, useInput } from 'ink';
import type { ReactNode } from 'react';
import { useState, useSyncExternalStore } from 'react';
import { Spinner } from '@inkjs/ui';
import type { WizardStore } from '../store.js';
import { OutroKind } from '../../../lib/wizard-session.js';
import opn from 'opn';
import { getCloudUrlFromRegion } from '../../../utils/urls.js';
import { slackSettingsUrl } from '../screens/SlackScreen.js';
import { fetchAmplitudeUser } from '../../../lib/api.js';
import type { AmplitudeZone } from '../../../lib/constants.js';
import { SlashCommandInput } from '../primitives/SlashCommandInput.js';
import { PickerMenu } from '../primitives/PickerMenu.js';
import { Colors, Icons } from '../styles.js';
import { Overlay } from '../router.js';
import {
  queryConsole,
  resolveConsoleCredentials,
  buildSessionContext,
  type ConversationTurn,
} from '../../../lib/console-query.js';
import {
  COMMANDS,
  getWhoamiText,
  getHelpText,
  TEST_PROMPT,
} from '../console-commands.js';

function executeCommand(raw: string, store: WizardStore): string | void {
  const [cmd] = raw.trim().split(/\s+/);

  switch (cmd) {
    case '/region':
      store.setRegionForced();
      break;
    case '/login':
      store.setCommandFeedback(
        'Re-authentication not yet available from within the wizard.',
      );
      break;
    case '/logout':
      store.setCommandFeedback(
        'Use `amplitude-wizard logout` from a new terminal to log out.',
      );
      break;
    case '/whoami':
      store.setCommandFeedback(getWhoamiText(store.session));
      break;
    case '/slack': {
      const region = store.session.region ?? 'us';
      const base = getCloudUrlFromRegion(region);
      const appName = region === 'eu' ? 'Amplitude - EU' : 'Amplitude';
      const open = (orgName: string | null) => {
        const url = slackSettingsUrl(base, orgName);
        opn(url, { wait: false }).catch(() => {
          /* fire-and-forget */
        });
        store.setCommandFeedback(
          `Opening Amplitude Settings → connect the "${appName}" Slack app.`,
        );
      };
      if (store.session.selectedOrgName) {
        open(store.session.selectedOrgName);
      } else if (store.session.credentials) {
        void fetchAmplitudeUser(
          store.session.credentials.accessToken,
          region as AmplitudeZone,
        )
          .then((info) => open(info.orgs[0]?.name ?? null))
          .catch(() => open(null));
      } else {
        open(null);
      }
      break;
    }
    case '/test':
      return TEST_PROMPT;
    case '/snake':
      store.showSnakeOverlay();
      break;
    case '/exit':
      store.setOutroData({ kind: OutroKind.Cancel, message: 'Exited.' });
      break;
    case '/help':
      store.setCommandFeedback(getHelpText());
      break;
    default:
      if (cmd) store.setCommandFeedback(`Unknown command: ${cmd}. Type /help.`);
  }
}

interface ConsoleViewProps {
  store: WizardStore;
  width: number;
  height: number;
  children?: ReactNode;
}

export const ConsoleView = ({
  store,
  width,
  height,
  children,
}: ConsoleViewProps) => {
  const [inputActive, setInputActive] = useState(false);
  const [initialValue, setInitialValue] = useState('');
  const [inputKey, setInputKey] = useState(0);
  const [response, setResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<ConversationTurn[]>([]);

  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const activate = (seed = '') => {
    setInitialValue(seed);
    setInputKey((k) => k + 1); // remount so initialValue takes effect
    setInputActive(true);
    store.setCommandMode(true);
  };

  const deactivate = () => {
    setInputActive(false);
    store.setCommandMode(false);
  };

  // Watch for activation keys while the input is dormant
  useInput(
    (char, key) => {
      // Escape or Q dismisses overlays: pending prompt (skip) or long response
      if (key.escape || char === 'q' || char === 'Q') {
        if (pendingPrompt) {
          store.resolvePrompt(pendingPrompt.kind === 'confirm' ? false : '');
          return;
        }
        if (responseIsLong) {
          setResponse(null);
          return;
        }
      }
      if (screenError && (char === 'r' || char === 'R')) {
        store.clearScreenError();
        return;
      }
      if (char === '/') {
        activate('/');
      } else if (key.tab) {
        activate('');
      }
    },
    { isActive: !inputActive },
  );

  const handleSubmit = (value: string) => {
    if (value.startsWith('/')) {
      setResponse(null);
      const query = executeCommand(value, store);
      if (query) {
        handleSubmit(query);
      }
      return;
    }

    setResponse(null);
    setLoading(true);
    const creds = resolveConsoleCredentials(store.session);
    const context = buildSessionContext(store.session);

    queryConsole(value, context, creds, history)
      .then((text) => {
        setResponse(text);
        setHistory((h) => [
          ...h,
          { role: 'user', content: value },
          { role: 'assistant', content: text },
        ]);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setResponse(`Error: ${msg}`);
      })
      .finally(() => setLoading(false));
  };

  const feedback = store.commandFeedback;
  const screenError = store.screenError;
  const showResponse = loading || !!response;
  const showFeedback = !showResponse && !!feedback;
  const innerWidth = width - 2;
  const separator = '─'.repeat(Math.max(0, innerWidth));
  const responseIsLong = !!response && response.split('\n').length > 3;
  const pendingPrompt = store.pendingPrompt;

  // Show the latest status message when an overlay is active — RunScreen's
  // own TabContainer handles this for the non-overlay case.
  const overlayValues: string[] = Object.values(Overlay);
  const isOverlay = overlayValues.includes(store.currentScreen);
  const lastStatus =
    isOverlay && store.statusMessages.length > 0
      ? store.statusMessages[store.statusMessages.length - 1]
      : null;

  return (
    <Box
      width={width}
      height={height}
      flexDirection="column"
      borderStyle="round"
      borderColor={Colors.muted}
    >
      {/* Content area — screens render here, prompt overlay, or long response */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {pendingPrompt ? (
          <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
            {pendingPrompt.kind === 'confirm' ? (
              <PickerMenu
                message={pendingPrompt.message}
                options={[
                  { label: 'Yes', value: 'yes' },
                  { label: 'No', value: 'no' },
                ]}
                onSelect={(v) => store.resolvePrompt(v === 'yes')}
              />
            ) : (
              <PickerMenu
                message={pendingPrompt.message}
                options={pendingPrompt.options.map((o) => ({
                  label: o,
                  value: o,
                }))}
                onSelect={(v) => store.resolvePrompt(v as string)}
              />
            )}
            <Text color={Colors.muted}> [Q / Esc] skip</Text>
          </Box>
        ) : responseIsLong ? (
          <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
            <Box justifyContent="flex-end">
              <Text color={Colors.muted}>[Q / Esc] close</Text>
            </Box>
            <Text color={Colors.primary}>{response}</Text>
          </Box>
        ) : (
          children
        )}
      </Box>

      {/* Status ticker — shown when an overlay is active (RunScreen handles its own) */}
      {lastStatus && (
        <Box paddingX={1} overflow="hidden">
          <Text color={Colors.muted}>{Icons.diamondOpen} </Text>
          <Text color={Colors.muted} wrap="truncate-end">
            {lastStatus}
          </Text>
        </Box>
      )}

      {/* Error banner — shown when a screen crashes or the agent fails to start */}
      {screenError && (
        <Box paddingX={1} gap={1}>
          <Text color={Colors.error} bold>
            ⚠
          </Text>
          <Box flexGrow={1} overflow="hidden">
            <Text color={Colors.error} wrap="truncate-end">
              {screenError.message}
            </Text>
          </Box>
          <Text color={Colors.muted}>[R] retry</Text>
        </Box>
      )}

      {/* Console input area */}
      <Text color={Colors.muted}>{separator}</Text>
      {showFeedback && (
        <Box paddingX={1}>
          <Text color={Colors.accent} bold>
            {' '}
          </Text>
          <Text color={Colors.muted}>{feedback}</Text>
        </Box>
      )}
      {showResponse && !responseIsLong && (
        <Box paddingX={1} paddingY={1} gap={1} flexDirection="column">
          {loading ? (
            <Spinner />
          ) : (
            <Text color={Colors.primary}>{response}</Text>
          )}
        </Box>
      )}
      {loading && responseIsLong && (
        <Box paddingX={1}>
          <Spinner />
        </Box>
      )}
      <Box paddingX={1}>
        <SlashCommandInput
          key={inputKey}
          commands={COMMANDS}
          isActive={inputActive}
          initialValue={initialValue}
          onSubmit={handleSubmit}
          onDeactivate={deactivate}
        />
      </Box>
    </Box>
  );
};
