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
  {
    cmd: '/create-project',
    desc: 'Create a new Amplitude project inline',
  },
  { cmd: '/mcp', desc: 'Install or remove the Amplitude MCP server' },
  { cmd: '/slack', desc: 'Set up Amplitude Slack integration' },
  {
    cmd: '/feedback',
    desc: 'Send product feedback',
  },
  { cmd: '/clear', desc: 'Clear the Q&A conversation history' },
  { cmd: '/debug', desc: 'Print a diagnostic snapshot (safe to share)' },
  { cmd: '/snake', desc: 'Play Snake' },
  { cmd: '/exit', desc: 'Exit the wizard' },
];

/**
 * Parses `/create-project <name>` from a slash command line.
 * Returns the trimmed name, or an empty string when no name was given.
 * Returns `undefined` if the line isn't a `/create-project` command.
 */
export function parseCreateProjectSlashInput(raw: string): string | undefined {
  const m = /^\s*\/create-project(?:\s+(.*))?\s*$/i.exec(raw);
  if (!m) return undefined;
  return (m[1] ?? '').trim();
}

/** Returns the feedback text for the /whoami command. */
export function getWhoamiText(
  session: Pick<
    WizardSession,
    | 'selectedOrgId'
    | 'selectedOrgName'
    | 'selectedWorkspaceName'
    | 'selectedEnvName'
    | 'region'
    | 'credentials'
    | 'userEmail'
  >,
): string {
  const loggedIn =
    session.credentials !== null && session.credentials !== undefined;
  const hasAnyIdentity =
    loggedIn ||
    session.userEmail ||
    session.selectedOrgName ||
    session.selectedOrgId;
  if (!hasAnyIdentity) {
    return 'Not logged in. Run /login to authenticate.';
  }
  const parts: string[] = [];
  if (session.userEmail) parts.push(session.userEmail);

  if (session.selectedOrgName || session.selectedOrgId) {
    const orgLabel =
      session.selectedOrgName ?? session.selectedOrgId ?? '(none)';
    parts.push(`org: ${orgLabel}`);
  }

  // Show project (Amplitude calls this "workspace" internally, but users
  // think of it as their project). Then show environment name + numeric ID.
  if (session.selectedWorkspaceName) {
    parts.push(`project: ${session.selectedWorkspaceName}`);
  }

  const envName = session.selectedEnvName;
  const envId =
    session.credentials?.appId && session.credentials.appId !== 0
      ? String(session.credentials.appId)
      : null;
  if (envName && envId) {
    parts.push(`env: ${envName} (${envId})`);
  } else if (envName) {
    parts.push(`env: ${envName}`);
  } else if (envId) {
    parts.push(`env: ${envId}`);
  }

  if (session.region) {
    parts.push(`region: ${session.region}`);
  }

  // Show masked API key so the user knows which key is active
  if (session.credentials?.projectApiKey) {
    const key = session.credentials.projectApiKey;
    const masked =
      key.length > 8 ? key.slice(0, 4) + '…' + key.slice(-4) : '****';
    parts.push(`key: ${masked}`);
  }

  // If we have some identity but no credentials yet, hint that setup is in progress
  if (!loggedIn && parts.length > 0) {
    parts.push('(authenticating…)');
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
