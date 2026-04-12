/**
 * console-commands.ts — Slash command definitions and pure helpers.
 *
 * Extracted from ConsoleView so they can be imported in tests without
 * pulling in React / Ink / store dependencies.
 */

import { OUTBOUND_URLS } from '../../lib/constants.js';
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

export const TEST_PROMPT: string =
  'Demo the wizard prompt tools. ' +
  'First, use the wizard-tools:confirm tool to ask if I want to continue. ' +
  'Then use the wizard-tools:choose tool to let me pick my favorite color from: Red, Blue, Green, Purple. ' +
  'Finally, summarize what I chose in one sentence.';

/** Returns the feedback text for the /whoami command. */
export function getWhoamiText(
  session: Pick<
    WizardSession,
    | 'selectedOrgId'
    | 'selectedOrgName'
    | 'selectedWorkspaceName'
    | 'selectedProjectName'
    | 'region'
  >,
  opts?: { email?: string },
): string {
  const orgName = session.selectedOrgName ?? '(none)';
  const orgUrl =
    session.selectedOrgId && session.region
      ? `${OUTBOUND_URLS.app[session.region]}/analytics/org/${
          session.selectedOrgId
        }`
      : null;
  const org = orgUrl
    ? `\u001B]8;;${orgUrl}\u0007${orgName}\u001B]8;;\u0007`
    : orgName;
  const project =
    session.selectedProjectName ?? session.selectedWorkspaceName ?? '(none)';
  const parts = [
    opts?.email ? `user: ${opts.email}` : null,
    `org: ${org}`,
    `project: ${project}`,
    `region: ${session.region ?? '(none)'}`,
  ]
    .filter(Boolean)
    .join('  ');
  return parts;
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
