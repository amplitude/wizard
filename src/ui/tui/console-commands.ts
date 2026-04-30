/**
 * console-commands.ts — Slash command definitions and pure helpers.
 *
 * Extracted from ConsoleView so they can be imported in tests without
 * pulling in React / Ink / store dependencies.
 */

import { RunPhase, type WizardSession } from '../../lib/wizard-session.js';
import {
  getBenchmarkFile,
  getCacheRoot,
  getCheckpointFile,
  getDashboardFile,
  getEventsFile,
  getLogFile,
  getProjectMetaDir,
  getRunDir,
  getStructuredLogFile,
} from '../../utils/storage-paths.js';

/**
 * Slash command registry.
 *
 * `requiresIdle: true` flags commands that mutate session credentials, region,
 * or org/project selection. Running these mid-flight pulls the rug out from
 * under the active agent — its in-flight Amplitude API / MCP calls would
 * silently fail or, worse, succeed against the wrong project. The console
 * dispatcher checks this flag and surfaces a friendly message instead of
 * dispatching while `runPhase === Running`.
 */
export interface CommandDef {
  cmd: string;
  desc: string;
  /** When true, the command is blocked while a setup run is active. */
  requiresIdle?: boolean;
}

export const COMMANDS: CommandDef[] = [
  {
    cmd: '/region',
    desc: 'Switch data-center region (US or EU)',
    requiresIdle: true,
  },
  { cmd: '/login', desc: 'Re-authenticate', requiresIdle: true },
  { cmd: '/logout', desc: 'Clear stored credentials', requiresIdle: true },
  { cmd: '/whoami', desc: 'Show current user, org, and project' },
  {
    cmd: '/create-project',
    desc: 'Create a new Amplitude project inline',
    requiresIdle: true,
  },
  { cmd: '/mcp', desc: 'Install or remove the Amplitude MCP server' },
  { cmd: '/slack', desc: 'Set up Amplitude Slack integration' },
  {
    cmd: '/feedback',
    desc: 'Send product feedback',
  },
  { cmd: '/clear', desc: 'Clear the Q&A conversation history' },
  { cmd: '/debug', desc: 'Print a diagnostic snapshot (safe to share)' },
  {
    cmd: '/diagnostics',
    desc: 'Show wizard storage paths (log file, cache, project meta dir)',
  },
  { cmd: '/snake', desc: 'Play Snake' },
  { cmd: '/exit', desc: 'Exit the wizard' },
];

/**
 * Per-command "paused while a setup run is active" copy. Tailored per
 * command so the user knows exactly what they tried to do and why it
 * didn't happen, rather than reading a generic "command unavailable"
 * message that gives them no path forward.
 */
const RUN_ACTIVE_BLOCK_MESSAGES: Record<string, string> = {
  '/region':
    'Region change is paused while a setup run is active. Cancel the run with Ctrl+C or wait for it to finish, then try again.',
  '/login':
    'Login is paused while a setup run is active. Cancel the run with Ctrl+C or wait for it to finish, then try again.',
  '/logout':
    'Logout is paused while a setup run is active. Cancel the run with Ctrl+C or wait for it to finish, then try again.',
  '/create-project':
    'Creating a new project is paused while a setup run is active. Cancel the run with Ctrl+C or wait for it to finish, then try again.',
};

/**
 * Returns true when the first whitespace-delimited token of `input` exactly
 * matches a registered slash command. Used by ConsoleView.handleSubmit to
 * distinguish real commands (/region) from slash-prefixed queries like
 * "/lib/config.ts is broken" or partial prefixes like "/r".
 */
export function isKnownCommand(input: string): boolean {
  const firstToken = input.trim().split(/\s+/)[0] ?? '';
  return COMMANDS.some((c) => c.cmd === firstToken);
}

/**
 * Returns the user-facing message to surface when a `requiresIdle` command
 * is invoked during an active run, or `null` if the command is allowed to
 * proceed in the current `runPhase`.
 *
 * Pure (no store / I/O) so it can be unit-tested without React or nanostores.
 */
export function checkCommandBlockedByRun(
  cmd: string,
  runPhase: RunPhase,
): string | null {
  if (runPhase !== RunPhase.Running) return null;
  const def = COMMANDS.find((c) => c.cmd === cmd);
  if (!def?.requiresIdle) return null;
  return (
    RUN_ACTIVE_BLOCK_MESSAGES[cmd] ??
    'This action is paused while a setup run is active. Cancel the run with Ctrl+C or wait for it to finish, then try again.'
  );
}

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
    | 'selectedProjectName'
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

  // Show project, then environment name + numeric ID.
  if (session.selectedProjectName) {
    parts.push(`project: ${session.selectedProjectName}`);
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
 * Build the human-readable text for the `/diagnostics` slash command.
 *
 * Shows where every wizard-managed file lives for the current project so a
 * user filing a bug report knows exactly which log to attach. Pure (no I/O)
 * so it can be unit-tested without filesystem mocks.
 */
export function getDiagnosticsText(installDir: string): string {
  const lines: string[] = [
    'Wizard storage paths:',
    '',
    'Per-project (this run):',
    `  log:        ${getLogFile(installDir)}`,
    `  log (json): ${getStructuredLogFile(installDir)}`,
    `  benchmark:  ${getBenchmarkFile(installDir)}`,
    `  checkpoint: ${getCheckpointFile(installDir)}`,
    `  run dir:    ${getRunDir(installDir)}`,
    '',
    'Project metadata (in your project root):',
    `  events:     ${getEventsFile(installDir)}`,
    `  dashboard:  ${getDashboardFile(installDir)}`,
    `  meta dir:   ${getProjectMetaDir(installDir)}`,
    '',
    `Cache root:   ${getCacheRoot()}`,
    '',
    'Tip: tar up the run dir to share with support:',
    `  tar -czf wizard-logs.tar.gz ${getRunDir(installDir)}`,
  ];
  return lines.join('\n');
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
