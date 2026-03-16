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
import { SlashCommandInput } from '../primitives/SlashCommandInput.js';
import { Colors } from '../styles.js';
import {
  queryConsole,
  resolveConsoleCredentials,
  buildSessionContext,
} from '../../../lib/console-query.js';

const COMMANDS = [
  { cmd: '/region', desc: 'Switch data-center region (US or EU)' },
  { cmd: '/login', desc: 'Re-authenticate' },
  { cmd: '/logout', desc: 'Clear credentials' },
  { cmd: '/whoami', desc: 'Show current user, org, and project' },
  { cmd: '/exit', desc: 'Exit the wizard' },
  { cmd: '/help', desc: 'List available slash commands' },
];

function executeCommand(raw: string, store: WizardStore): void {
  const [cmd] = raw.trim().split(/\s+/);

  switch (cmd) {
    case '/region':
      store.setRegionForced();
      break;
    case '/login':
      store.setCommandFeedback('Re-authentication not yet available from within the wizard.');
      break;
    case '/logout':
      store.setCommandFeedback('Use `amplitude-wizard logout` from a new terminal to log out.');
      break;
    case '/whoami': {
      const s = store.session;
      store.setCommandFeedback(
        `org: ${s.selectedOrgName ?? '(none)'}  workspace: ${s.selectedWorkspaceName ?? '(none)'}  region: ${s.region ?? '(none)'}`,
      );
      break;
    }
    case '/exit':
      store.setOutroData({ kind: OutroKind.Cancel, message: 'Exited.' });
      break;
    case '/help': {
      const lines = COMMANDS.map((c) => `${c.cmd}  ${c.desc}`).join('  ·  ');
      store.setCommandFeedback(lines);
      break;
    }
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

export const ConsoleView = ({ store, width, height, children }: ConsoleViewProps) => {
  const [inputActive, setInputActive] = useState(false);
  const [initialValue, setInitialValue] = useState('');
  const [inputKey, setInputKey] = useState(0);
  const [response, setResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      executeCommand(value, store);
      return;
    }

    setResponse(null);
    setLoading(true);
    const creds = resolveConsoleCredentials(store.session);
    const context = buildSessionContext(store.session);

    queryConsole(value, context, creds)
      .then((text) => setResponse(text))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setResponse(`Error: ${msg}`);
      })
      .finally(() => setLoading(false));
  };

  const feedback = store.commandFeedback;
  const showResponse = loading || !!response;
  const showFeedback = !showResponse && !!feedback;
  const innerWidth = width - 2;
  const separator = '─'.repeat(Math.max(0, innerWidth));

  return (
    <Box
      width={width}
      height={height}
      flexDirection="column"
      borderStyle="round"
      borderColor={Colors.muted}
    >
      {/* Content area — screens render here */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {children}
      </Box>

      {/* Console input area */}
      <Text dimColor>{separator}</Text>
      {showFeedback && (
        <Box paddingX={1}>
          <Text color={Colors.accent} bold>{' '}</Text>
          <Text dimColor>{feedback}</Text>
        </Box>
      )}
      {showResponse && (
        <Box paddingX={1} gap={1}>
          {loading ? (
            <Spinner />
          ) : (
            <Text color={Colors.primary} wrap="truncate-end">
              {response}
            </Text>
          )}
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
