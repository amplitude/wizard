/**
 * SlashCommandBar — Persistent command input at the bottom of every screen.
 *
 * Always visible. Typing "/" activates command mode; subsequent characters
 * build the command string. Enter executes, Escape cancels.
 *
 * While command mode is active, all other useInput handlers are deactivated
 * via CommandModeContext + useScreenInput.
 */

import { Box, Text, useInput } from 'ink';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { Colors } from '../styles.js';

const COMMANDS = [
  { cmd: '/org', desc: 'Switch the active org' },
  { cmd: '/project', desc: 'Switch the active project' },
  { cmd: '/region', desc: 'Switch data-center region (US or EU)' },
  { cmd: '/login', desc: 'Re-authenticate' },
  { cmd: '/logout', desc: 'Clear credentials' },
  { cmd: '/whoami', desc: 'Show current user, org, and project' },
  { cmd: '/help', desc: 'List available slash commands' },
];

function executeCommand(raw: string, store: WizardStore): void {
  const [cmd, ...argParts] = raw.trim().split(/\s+/);
  const _args = argParts.join(' ');

  switch (cmd) {
    case '/org':
    case '/project':
      store.setOrgProjectForced(true);
      break;

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
      const org = s.selectedOrgName ?? '(none)';
      const workspace = s.selectedWorkspaceName ?? '(none)';
      const region = s.region ?? '(none)';
      store.setCommandFeedback(`org: ${org}  workspace: ${workspace}  region: ${region}`);
      break;
    }

    case '/help': {
      const lines = COMMANDS.map((c) => `${c.cmd}  ${c.desc}`).join('  ·  ');
      store.setCommandFeedback(lines);
      break;
    }

    default:
      if (cmd) {
        store.setCommandFeedback(`Unknown command: ${cmd}. Type /help for a list.`);
      }
  }
}

interface SlashCommandBarProps {
  store: WizardStore;
  width: number;
}

export const SlashCommandBar = ({ store, width }: SlashCommandBarProps) => {
  const [input, setInput] = useState('');

  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const commandMode = store.commandMode;
  const feedback = store.commandFeedback;

  useInput((char, key) => {
    if (!commandMode) {
      if (char === '/') {
        store.setCommandMode(true);
        setInput('/');
      }
      return;
    }

    // In command mode — capture all input
    if (key.escape) {
      store.setCommandMode(false);
      setInput('');
      return;
    }

    if (key.return) {
      executeCommand(input, store);
      store.setCommandMode(false);
      setInput('');
      return;
    }

    if (key.backspace || key.delete) {
      const next = input.slice(0, -1);
      if (next === '') {
        store.setCommandMode(false);
        setInput('');
      } else {
        setInput(next);
      }
      return;
    }

    // Ignore modifier combos
    if (key.ctrl || key.meta) return;

    if (char) {
      setInput((prev) => prev + char);
    }
  });

  // Determine what to display in the bar
  let barContent: React.ReactNode;

  if (commandMode) {
    barContent = (
      <Text>
        <Text color={Colors.accent} bold>
          {' '}
        </Text>
        <Text>{input}</Text>
        <Text inverse> </Text>
      </Text>
    );
  } else if (feedback) {
    barContent = (
      <Text>
        <Text color={Colors.accent} bold>
          {' '}
        </Text>
        <Text>{feedback}</Text>
      </Text>
    );
  } else {
    barContent = (
      <Text dimColor>{'  > '}</Text>
    );
  }

  return (
    <Box
      width={width}
      borderStyle="single"
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderColor={commandMode ? Colors.accent : Colors.muted}
      paddingX={1}
      overflow="hidden"
    >
      {barContent}
    </Box>
  );
};
