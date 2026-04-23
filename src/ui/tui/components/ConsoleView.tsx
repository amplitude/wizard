/**
 * ConsoleView — Full-screen wrapper without outer border.
 *
 * Layout: content area + separator + console input with ❯ prompt.
 * Handles slash commands, AI queries, pending prompts, and error banners.
 * KeyHintBar integrated above the input line.
 */

import { Box, Text, useInput } from 'ink';
import type { ReactNode } from 'react';
import { useState, useEffect } from 'react';
import { Spinner } from '@inkjs/ui';
import type { WizardStore } from '../store.js';
import { OutroKind } from '../session-constants.js';
import { SlashCommandInput } from '../primitives/index.js';
import { PickerMenu } from '../primitives/index.js';
import { Colors, Icons, Layout } from '../styles.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { linkify, renderMarkdown } from '../utils/terminal-rendering.js';
import { Overlay } from '../router.js';
import {
  queryConsole,
  resolveConsoleCredentials,
  buildSessionContext,
  type ConversationTurn,
} from '../../../lib/console-query.js';
import { DEFAULT_AMPLITUDE_ZONE } from '../../../lib/constants.js';
import { resolveZone } from '../../../lib/zone-resolution.js';
import {
  COMMANDS,
  getWhoamiText,
  parseFeedbackSlashInput,
  parseCreateProjectSlashInput,
} from '../console-commands.js';
import { analytics } from '../../../utils/analytics.js';
import { trackWizardFeedback } from '../../../utils/track-wizard-feedback.js';
import { KeyHintBar, type KeyHint } from './KeyHintBar.js';

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
      // Show current data immediately, then refresh from API
      store.setCommandFeedback(getWhoamiText(store.session), 30_000);
      if (store.session.credentials?.idToken) {
        // readDisk: true — /whoami may fire at any point in the session,
        // including before RegionSelect is reached.
        const zone = resolveZone(store.session, DEFAULT_AMPLITUDE_ZONE, {
          readDisk: true,
        });
        void import('../../../lib/api.js').then(({ fetchAmplitudeUser }) => {
          fetchAmplitudeUser(store.session.credentials!.idToken!, zone)
            .then((userInfo) => {
              if (userInfo.email) {
                store.session.userEmail = userInfo.email;
                analytics.setDistinctId(userInfo.email);
                analytics.identifyUser({
                  email: userInfo.email,
                  org_id: store.session.selectedOrgId ?? undefined,
                  org_name: store.session.selectedOrgName ?? undefined,
                  workspace_id: store.session.selectedWorkspaceId ?? undefined,
                  workspace_name:
                    store.session.selectedWorkspaceName ?? undefined,
                  app_id: store.session.selectedAppId,
                  env_name: store.session.selectedEnvName,
                  region: zone,
                  integration: store.session.integration,
                });
              }
              const orgId = store.session.selectedOrgId;
              if (orgId) {
                const org = userInfo.orgs.find((o) => o.id === orgId);
                if (org) store.session.selectedOrgName = org.name;
              }
              store.setCommandFeedback(getWhoamiText(store.session), 30_000);
            })
            .catch(() => {
              // Non-fatal — keep showing what we have
            });
        });
      }
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
    case '/mcp':
      store.showMcpOverlay();
      break;
    case '/create-project': {
      // Requires an authenticated session with a selected org so the proxy
      // call has an orgId. Surface a friendly message otherwise.
      const hasAuth = Boolean(
        store.session.pendingAuthIdToken || store.session.credentials?.idToken,
      );
      const hasOrg = Boolean(store.session.selectedOrgId);
      if (!hasAuth) {
        store.setCommandFeedback(
          'Sign in first (/login) before creating a project.',
        );
        break;
      }
      if (!hasOrg) {
        store.setCommandFeedback(
          'Pick an organization first (the Auth screen) before creating a project.',
        );
        break;
      }
      const suggested = parseCreateProjectSlashInput(raw);
      store.startCreateProject('slash', suggested || null);
      break;
    }
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
  /** Extra key hints from the active screen. */
  screenHints?: KeyHint[];
  children?: ReactNode;
}

export const ConsoleView = ({
  store,
  width,
  height,
  screenHints,
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

  useWizardStore(store);

  const activate = (seed = '') => {
    setInitialValue(seed);
    setInputKey((k) => k + 1);
    setInputActive(true);
    store.setCommandMode(true);
  };

  const deactivate = () => {
    setInputActive(false);
    store.setCommandMode(false);
  };

  const feedback = store.commandFeedback;
  const screenError = store.screenError;
  const showResponse = loading || !!response;
  const showFeedback = !showResponse && !!feedback;
  const innerWidth = width;
  const separator = Layout.separatorChar.repeat(Math.max(0, innerWidth - 2));
  const responseIsLong = !!response && response.split('\n').length > 3;
  const pendingPrompt = store.pendingPrompt;

  // Watch for activation keys while the input is dormant
  useInput(
    (char, key) => {
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
      if (char === '/') {
        activate('/');
      } else if (
        key.tab &&
        store.session.credentials !== null &&
        store.session.introConcluded
      ) {
        activate('');
      }
    },
    { isActive: !inputActive },
  );

  const handleSubmit = (value: string) => {
    const isSlashCommand = value.startsWith('/');
    analytics.wizardCapture('agent message sent', {
      'message length': value.length,
      'is slash command': isSlashCommand,
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
          ...h.slice(-8),
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

  // Reset plan input state when the prompt clears
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

      // options mode — require explicit Y to approve (Enter alone is too easy
      // to hit accidentally while the plan is pending in the background)
      const lc = char.toLowerCase();
      if (lc === 'y') {
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

  // Show the latest status message when an overlay is active
  const overlayValues: string[] = Object.values(Overlay);
  const isOverlay = overlayValues.includes(store.currentScreen);
  const lastStatus =
    isOverlay && store.statusMessages.length > 0
      ? store.statusMessages[store.statusMessages.length - 1]
      : null;

  return (
    <Box width={width} height={height} flexDirection="column">
      {/* Content area */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {pendingPrompt ? (
          <Box
            flexDirection="column"
            flexGrow={1}
            paddingX={Layout.paddingX}
            paddingY={1}
          >
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
                <Text color={Colors.muted}>Suggested events for your app:</Text>
                <Text color={Colors.heading} bold>
                  Instrumentation Plan
                </Text>
                {pendingPrompt.events.map((e, i) => (
                  <Text key={e.name || i} wrap="wrap">
                    <Text color={Colors.accent} bold>
                      {Icons.bullet} {e.name}
                    </Text>
                    {e.description ? (
                      <Text color={Colors.secondary}> — {e.description}</Text>
                    ) : null}
                  </Text>
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
          <Box
            flexDirection="column"
            flexGrow={1}
            paddingX={Layout.paddingX}
            paddingY={1}
            overflow="hidden"
          >
            <Text color={Colors.accent}>
              {response ? renderMarkdown(response).trimEnd() : ''}
            </Text>
            <Box marginTop={1}>
              <Text color={Colors.muted}>[Q / Esc] close</Text>
            </Box>
          </Box>
        ) : (
          children
        )}
      </Box>

      {/* Status ticker — shown when an overlay is active */}
      {lastStatus && (
        <Box paddingX={Layout.paddingX} overflow="hidden">
          <Text color={Colors.muted}>{Icons.diamondOpen} </Text>
          <Text color={Colors.muted} wrap="truncate-end">
            {linkify(lastStatus)}
          </Text>
        </Box>
      )}

      {/* Error banner */}
      {screenError && (
        <Box paddingX={Layout.paddingX} gap={1}>
          <Text color={Colors.error} bold>
            {Icons.cross}
          </Text>
          <Box flexGrow={1} overflow="hidden">
            <Text color={Colors.error} wrap="truncate-end">
              {screenError.message}
            </Text>
          </Box>
          <Text color={Colors.muted}>[R] retry</Text>
        </Box>
      )}

      {/* Separator */}
      <Box paddingX={1}>
        <Text color={Colors.border}>{separator}</Text>
      </Box>

      {/* Feedback line */}
      {showFeedback && (
        <Box paddingX={Layout.paddingX}>
          <Text color={Colors.accent}>{Icons.prompt} </Text>
          <Text color={Colors.secondary}>{feedback}</Text>
        </Box>
      )}

      {/* Response line */}
      {showResponse && !responseIsLong && (
        <Box
          paddingX={Layout.paddingX}
          paddingY={1}
          gap={1}
          flexDirection="column"
        >
          {loading ? (
            <Spinner />
          ) : (
            <Text color={Colors.accent}>
              {response ? renderMarkdown(response).trimEnd() : ''}
            </Text>
          )}
        </Box>
      )}
      {loading && responseIsLong && (
        <Box paddingX={Layout.paddingX}>
          <Spinner />
        </Box>
      )}

      {/* Key hints + console input */}
      <KeyHintBar
        hints={screenHints}
        width={innerWidth}
        showAskHint={
          store.session.credentials !== null && store.session.introConcluded
        }
      />
      <Box paddingX={Layout.paddingX}>
        <Text color={inputActive ? Colors.accent : Colors.muted}>
          {Icons.prompt}{' '}
        </Text>
        {inputActive ? (
          <SlashCommandInput
            key={inputKey}
            commands={COMMANDS}
            isActive={inputActive}
            initialValue={initialValue}
            onSubmit={handleSubmit}
            onDeactivate={deactivate}
          />
        ) : (
          <Text color={Colors.disabled}>
            {store.session.credentials !== null && store.session.introConcluded
              ? 'Press / for commands or Tab to ask a question'
              : 'Press / for commands'}
          </Text>
        )}
      </Box>
    </Box>
  );
};
