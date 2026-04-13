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
import { useState, useEffect, useSyncExternalStore } from 'react';
import { Spinner } from '@inkjs/ui';
import type { WizardStore } from '../store.js';
import { OutroKind } from '../../../lib/wizard-session.js';
import { SlashCommandInput } from '../primitives/SlashCommandInput.js';
import { PickerMenu } from '../primitives/PickerMenu.js';
import { Colors, Icons } from '../styles.js';
import { Overlay } from '../router.js';
import { Screen } from '../flows.js';
import {
  queryConsole,
  resolveConsoleCredentials,
  buildSessionContext,
  type ConversationTurn,
} from '../../../lib/console-query.js';
import {
  COMMANDS,
  getWhoamiText,
  parseFeedbackSlashInput,
  TEST_PROMPT,
} from '../console-commands.js';
import { analytics } from '../../../utils/analytics.js';
import { trackWizardFeedback } from '../../../utils/track-wizard-feedback.js';

function executeCommand(raw: string, store: WizardStore): string | void {
  const [cmd] = raw.trim().split(/\s+/);

  switch (cmd) {
    case '/region':
      store.setRegionForced();
      break;
    case '/login':
      store.showLoginOverlay();
      break;
    case '/logout':
      store.showLogoutOverlay();
      break;
    case '/whoami':
      store.setCommandFeedback(getWhoamiText(store.session), 30_000);
      break;
    case '/slack':
      store.showSlackOverlay();
      break;
    case '/feedback': {
      const message = parseFeedbackSlashInput(raw);
      if (!message) {
        store.setCommandFeedback('Usage: /feedback <your message>');
        break;
      }
      void trackWizardFeedback(message)
        .then(() =>
          store.setCommandFeedback('Thanks — your feedback was sent.'),
        )
        .catch((err: unknown) => {
          store.setCommandFeedback(
            `Could not send feedback: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
      break;
    }
    case '/test':
      return TEST_PROMPT;
    case '/mcp':
      store.showMcpOverlay();
      break;
    case '/snake':
      store.showSnakeOverlay();
      break;
    case '/exit':
      store.setOutroData({ kind: OutroKind.Cancel, message: 'Exited.' });
      break;
    default:
      if (cmd)
        store.setCommandFeedback(
          `Unknown command: ${cmd}. Type / to see available commands.`,
        );
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

  // Event plan prompt local state
  const [planInputMode, setPlanInputMode] = useState<'options' | 'feedback'>(
    'options',
  );
  const [planFeedbackText, setPlanFeedbackText] = useState('');
  const [planCursorVisible, setPlanCursorVisible] = useState(true);

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

  const isIntro = store.currentScreen === Screen.Intro;
  const feedback = store.commandFeedback;
  const screenError = store.screenError;
  const showResponse = loading || !!response;
  const showFeedback = !showResponse && !!feedback;
  const innerWidth = width - 2;
  const separator = '─'.repeat(Math.max(0, innerWidth));
  const responseIsLong = !!response && response.split('\n').length > 3;
  const pendingPrompt = store.pendingPrompt;

  // Watch for activation keys while the input is dormant
  useInput(
    (char, key) => {
      // Escape or Q dismisses overlays: pending prompt (skip) or long response
      if (key.escape || char === 'q' || char === 'Q') {
        if (pendingPrompt && pendingPrompt.kind !== 'event-plan') {
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
      if (!isIntro) {
        if (char === '/') {
          activate('/');
        } else if (key.tab) {
          activate('');
        }
      }
    },
    { isActive: !inputActive },
  );

  const handleSubmit = (value: string) => {
    const isSlashCommand = value.startsWith('/');
    analytics.wizardCapture('Agent Message Sent', {
      message_length: value.length,
      is_slash_command: isSlashCommand,
    });
    if (isSlashCommand) {
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

  // Blinking cursor for event-plan feedback input
  useEffect(() => {
    if (planInputMode !== 'feedback') return;
    const id = setInterval(() => setPlanCursorVisible((v) => !v), 530);
    return () => clearInterval(id);
  }, [planInputMode]);

  // Reset plan input state when the prompt clears (agent got the answer)
  useEffect(() => {
    if (!pendingPrompt) {
      setPlanInputMode('options');
      setPlanFeedbackText('');
    }
  }, [pendingPrompt]);

  // Keyboard handling for event-plan prompt
  useInput(
    (char, key) => {
      if (!pendingPrompt || pendingPrompt.kind !== 'event-plan') return;

      if (planInputMode === 'feedback') {
        if (key.return) {
          const text = planFeedbackText.trim();
          if (text) {
            store.resolveEventPlan({ decision: 'revised', feedback: text });
            setPlanFeedbackText('');
            setPlanInputMode('options');
          }
          return;
        }
        if (key.escape) {
          setPlanInputMode('options');
          setPlanFeedbackText('');
          return;
        }
        if (key.backspace || key.delete) {
          setPlanFeedbackText((v) => v.slice(0, -1));
          return;
        }
        if (!key.ctrl && !key.meta && !key.tab && char) {
          setPlanFeedbackText((v) => v + char);
        }
        return;
      }

      // options mode
      const lc = char.toLowerCase();
      if (lc === 'y' || key.return) {
        store.resolveEventPlan({ decision: 'approved' });
      } else if (lc === 's') {
        store.resolveEventPlan({ decision: 'skipped' });
      } else if (lc === 'f') {
        setPlanInputMode('feedback');
      }
    },
    {
      isActive:
        !inputActive && !!pendingPrompt && pendingPrompt.kind === 'event-plan',
    },
  );

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
            ) : pendingPrompt.kind === 'choice' ? (
              <PickerMenu
                message={pendingPrompt.message}
                options={pendingPrompt.options.map((o) => ({
                  label: o,
                  value: o,
                }))}
                onSelect={(v) => store.resolvePrompt(v as string)}
              />
            ) : (
              <Box flexDirection="column" gap={1}>
                <Text color={Colors.primary} bold>
                  Instrumentation Plan
                </Text>
                {pendingPrompt.events.map((e) => (
                  <Box key={e.name} flexDirection="column">
                    <Text color={Colors.accent} bold>
                      {e.name}
                    </Text>
                    <Text color={Colors.muted}>{e.description}</Text>
                  </Box>
                ))}
                {planInputMode === 'feedback' ? (
                  <Box gap={1}>
                    <Text color={Colors.muted}>Feedback: </Text>
                    <Text>
                      {planFeedbackText}
                      {planCursorVisible ? '▎' : ' '}
                    </Text>
                    <Text color={Colors.muted}>[Enter] send [Esc] cancel</Text>
                  </Box>
                ) : (
                  <Text color={Colors.muted}>
                    [Y] approve [S] skip [F] give feedback
                  </Text>
                )}
              </Box>
            )}
            {pendingPrompt.kind !== 'event-plan' && (
              <Text color={Colors.muted}> [Q / Esc] skip</Text>
            )}
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

      {/* Console input area — hidden on the Intro screen */}
      {!isIntro && (
        <>
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
        </>
      )}
    </Box>
  );
};
