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
  {
    cmd: '/feedback',
    desc: 'Send product feedback',
  },
  { cmd: '/snake', desc: 'Play Snake' },
  { cmd: '/exit', desc: 'Exit the wizard' },
];

/** Returns the feedback text for the /whoami command. */
export function getWhoamiText(
  session: Pick<
    WizardSession,
    | 'selectedOrgName'
    | 'selectedWorkspaceName'
    | 'region'
    | 'credentials'
    | 'userEmail'
  >,
): string {
  const loggedIn =
    session.credentials !== null && session.credentials !== undefined;
  if (!loggedIn && !session.selectedOrgName) {
    return 'Not logged in. Run /login to authenticate.';
  }
  const parts: string[] = [];
  if (session.userEmail) parts.push(session.userEmail);
  parts.push(`org: ${session.selectedOrgName ?? '(none)'}`);
  parts.push(`workspace: ${session.selectedWorkspaceName ?? '(none)'}`);
  parts.push(`region: ${session.region ?? '(none)'}`);
  return parts.join('  ');
}

/**
 * Parses `/feedback <message>` from a slash command line.
 * Returns `undefined` if the line is not a feedback command or the message is empty.
 */
export function parseFeedbackSlashInput(raw: string): string | undefined {
  const m = /^\s*\/feedback(?:\s+(.*))?\s*$/i.exec(raw);
  if (!m) return undefined;
  const body = m[1]?.trim();
  return body || undefined;
}
