/**
 * console-commands.ts — Slash command definitions and pure helpers.
 *
 * Extracted from ConsoleView so they can be imported in tests without
 * pulling in React / Ink / store dependencies.
 */

import type { WizardSession } from '../../lib/wizard-session.js';

export const COMMANDS = [
  { cmd: '/region', desc: 'Switch data-center region (US or EU)' },
  { cmd: '/login', desc: 'Re-authenticate' },
  { cmd: '/logout', desc: 'Clear stored credentials' },
  { cmd: '/whoami', desc: 'Show current user, org, and project' },
  { cmd: '/mcp', desc: 'Install or remove the Amplitude MCP server' },
  { cmd: '/slack', desc: 'Set up Amplitude Slack integration' },
  { cmd: '/test', desc: 'Run a prompt-skill demo (confirm + choose)' },
  { cmd: '/snake', desc: 'Play Snake' },
  { cmd: '/exit', desc: 'Exit the wizard' },
  { cmd: '/help', desc: 'List available slash commands' },
];

export const TEST_PROMPT: string =
  'Demo the wizard prompt tools. ' +
  'First, use the wizard-tools:confirm tool to ask if I want to continue. ' +
  'Then use the wizard-tools:choose tool to let me pick my favorite color from: Red, Blue, Green, Purple. ' +
  'Finally, summarize what I chose in one sentence.';

/** Returns the feedback text for the /whoami command. */
export function getWhoamiText(
  session: Pick<
    WizardSession,
    'selectedOrgName' | 'selectedWorkspaceName' | 'region'
  >,
): string {
  return `org: ${session.selectedOrgName ?? '(none)'}  workspace: ${
    session.selectedWorkspaceName ?? '(none)'
  }  region: ${session.region ?? '(none)'}`;
}

/** Returns the feedback text for the /help command. */
export function getHelpText(): string {
  const maxCmd = Math.max(...COMMANDS.map((c) => c.cmd.length));
  return COMMANDS.map((c) => `${c.cmd.padEnd(maxCmd)}  ${c.desc}`).join('\n');
}
