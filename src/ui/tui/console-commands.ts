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
  { cmd: '/logout', desc: 'Clear credentials' },
  { cmd: '/whoami', desc: 'Show current user, org, and project' },
  { cmd: '/slack', desc: 'Set up Amplitude Slack integration' },
  { cmd: '/snake', desc: 'Play Snake' },
  { cmd: '/exit', desc: 'Exit the wizard' },
  { cmd: '/help', desc: 'List available slash commands' },
];

/** Returns the feedback text for the /whoami command. */
export function getWhoamiText(session: Pick<WizardSession, 'selectedOrgName' | 'selectedWorkspaceName' | 'region'>): string {
  return `org: ${session.selectedOrgName ?? '(none)'}  workspace: ${session.selectedWorkspaceName ?? '(none)'}  region: ${session.region ?? '(none)'}`;
}

/** Returns the feedback text for the /help command. */
export function getHelpText(): string {
  return COMMANDS.map((c) => `${c.cmd}  ${c.desc}`).join('  ·  ');
}
