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
    | 'selectedOrgId'
    | 'selectedOrgName'
    | 'selectedWorkspaceId'
    | 'selectedWorkspaceName'
    | 'selectedProjectName'
    | 'region'
    | 'credentials'
    | 'userEmail'
  >,
): string {
  const loggedIn =
    session.credentials !== null && session.credentials !== undefined;
  if (!loggedIn && !session.selectedOrgName && !session.selectedOrgId) {
    return 'Not logged in. Run /login to authenticate.';
  }
  const parts: string[] = [];
  if (session.userEmail) parts.push(session.userEmail);

  const orgLabel = session.selectedOrgName ?? session.selectedOrgId ?? '(none)';
  const wsLabel =
    session.selectedWorkspaceName ?? session.selectedWorkspaceId ?? '(none)';
  parts.push(`org: ${orgLabel}`);
  parts.push(`workspace: ${wsLabel}`);

  if (session.selectedProjectName) {
    parts.push(`project: ${session.selectedProjectName}`);
  }
  parts.push(`region: ${session.region ?? '(none)'}`);

  // Show masked API key so the user knows which key is active
  if (session.credentials?.projectApiKey) {
    const key = session.credentials.projectApiKey;
    const masked =
      key.length > 8 ? key.slice(0, 4) + '…' + key.slice(-4) : '****';
    parts.push(`key: ${masked}`);
  }

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
