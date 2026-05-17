/**
 * console-commands.ts — Slash command definitions and pure helpers.
 *
 * Extracted from ConsoleView so they can be imported in tests without
 * pulling in React / Ink / store dependencies.
 */

import { AGENT_EVENT_WIRE_VERSION } from '../../lib/agent-events.js';
import { WIZARD_VERSION } from '../../lib/constants.js';
import { RunPhase, type WizardSession } from '../../lib/wizard-session.js';
import {
  getBenchmarkFile,
  getCacheRoot,
  getCheckpointFile,
  getDashboardFile,
  getEventsFile,
  getLogFile,
  getProjectBindingFile,
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
    cmd: '/help',
    desc: 'List every slash command and what it does',
  },
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
  {
    cmd: '/diff',
    desc: 'Show files changed by the agent (or a single file with /diff <path>)',
  },
  { cmd: '/debug', desc: 'Print a diagnostic snapshot (safe to share)' },
  {
    cmd: '/diagnostics',
    desc: 'Show wizard storage paths (log file, cache, project meta dir)',
  },
  {
    cmd: '/version',
    desc: 'Show wizard, agent-mode protocol, Node, and platform versions',
  },
  { cmd: '/snake', desc: 'Play Snake' },
  { cmd: '/exit', desc: 'Exit the wizard' },
];

/**
 * Per-command "paused while a setup run is active" copy. Tailored per
 * command so the user knows exactly what they tried to do and why it
 * didn't happen, rather than reading a generic "command unavailable"
 * message that gives them no path forward.
 *
 * Each entry contributes a `<subject> is paused` line; the shared trailer
 * ("Cancel the run with Ctrl+C…") is appended by `formatRunBlockMessage`
 * so the four messages can't drift out of sync.
 */
const RUN_ACTIVE_BLOCK_SUBJECTS: Record<string, string> = {
  '/region': 'Region change',
  '/login': 'Login',
  '/logout': 'Logout',
  '/create-project': 'Creating a new project',
};

const RUN_ACTIVE_BLOCK_TRAILER =
  'while a setup run is active. Cancel the run with Ctrl+C or wait for it to finish, then try again.';

function formatRunBlockMessage(subject: string): string {
  return `${subject} is paused ${RUN_ACTIVE_BLOCK_TRAILER}`;
}

const GENERIC_RUN_BLOCK_MESSAGE = formatRunBlockMessage('This action');

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
  const subject = RUN_ACTIVE_BLOCK_SUBJECTS[cmd];
  return subject ? formatRunBlockMessage(subject) : GENERIC_RUN_BLOCK_MESSAGE;
}

/**
 * Generic slash-arg parser. Returns the trimmed argument string after
 * `cmd` when `raw` starts with that command (case-insensitive), an empty
 * string when the command was typed with no argument, and `undefined`
 * when `raw` is some other command entirely.
 *
 * The individual `parseFooSlashInput` helpers below are thin wrappers so
 * callers can keep using the named functions (and so this stays easy to
 * mock per-command in tests if needed). Before consolidation each parser
 * hand-rolled the same `^\s*\/cmd(?:\s+(.*))?\s*$` regex.
 */
export function parseSlashArg(cmd: string, raw: string): string | undefined {
  // Escape regex metacharacters in `cmd` so callers can't accidentally
  // inject a pattern by passing e.g. `/foo.bar`.
  const escaped = cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^\\s*${escaped}(?:\\s+(.*))?\\s*$`, 'i');
  const m = re.exec(raw);
  if (!m) return undefined;
  return (m[1] ?? '').trim();
}

/**
 * Parses `/create-project <name>` from a slash command line.
 * Returns the trimmed name, or an empty string when no name was given.
 * Returns `undefined` if the line isn't a `/create-project` command.
 */
export function parseCreateProjectSlashInput(raw: string): string | undefined {
  return parseSlashArg('/create-project', raw);
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
 * Multi-line version of the `/diagnostics` output, for the in-TUI feedback
 * panel. Each entry renders as its own row so long absolute paths
 * (`/Users/…/.amplitude/wizard/runs/<sha>/log.txt`) are never hard-truncated
 * by a single overflow-hidden Text element — the original bug behind
 * "log file: /Users/…" in the screenshot.
 *
 * {@link getDiagnosticsText} is the joined-string flavour for callers that
 * need a single blob (e.g. writing the bug-report attachment to disk).
 */
export function getDiagnosticsLines(installDir: string): string[] {
  return [
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
    `  binding:    ${getProjectBindingFile(installDir)}`,
    `  meta dir:   ${getProjectMetaDir(installDir)}`,
    '',
    `Cache root:   ${getCacheRoot()}`,
    '',
    'Tip: tar up the run dir to share with support:',
    `  tar -czf wizard-logs.tar.gz ${getRunDir(installDir)}`,
  ];
}

/**
 * Build the human-readable text for the `/diagnostics` slash command.
 *
 * Shows where every wizard-managed file lives for the current project so a
 * user filing a bug report knows exactly which log to attach. Pure (no I/O)
 * so it can be unit-tested without filesystem mocks.
 *
 * Defined in terms of {@link getDiagnosticsLines} so the two stay in sync —
 * an earlier hand-rolled version maintained its own list and silently drifted
 * (Bugbot 3221826573 caught the duplicated walk).
 */
export function getDiagnosticsText(installDir: string): string {
  return getDiagnosticsLines(installDir).join('\n');
}

/**
 * Parses `/feedback <message>` from a slash command line.
 * Returns `undefined` if the line is not a feedback command or the message is empty.
 *
 * Unlike most slash parsers, `/feedback` collapses the "command with no
 * arg" case to `undefined` (treated as a usage error in the dispatcher)
 * rather than the empty string.
 */
export function parseFeedbackSlashInput(raw: string): string | undefined {
  const arg = parseSlashArg('/feedback', raw);
  if (arg === undefined) return undefined;
  return arg || undefined;
}

/**
 * Parse `/diff [path]`. Returns:
 *   - undefined when the line isn't a `/diff` command
 *   - empty string when no path argument was provided (summary mode)
 *   - trimmed path string when a path argument was provided
 */
export function parseDiffSlashInput(raw: string): string | undefined {
  return parseSlashArg('/diff', raw);
}

/**
 * Build the help text for `/help`. Pure (no I/O) so unit tests can lock
 * the command catalogue without rendering Ink.
 */
export function getHelpText(): string {
  const lines = ['Available slash commands:', ''];
  // Pad command column for readable column alignment in monospace.
  const width = COMMANDS.reduce((w, c) => Math.max(w, c.cmd.length), 0);
  for (const c of COMMANDS) {
    lines.push(`  ${c.cmd.padEnd(width)}  ${c.desc}`);
  }
  return lines.join('\n');
}

/**
 * Runtime info surfaced by `/version`. Injectable so tests can pin the
 * shape against fixed values without mocking `process` globals.
 */
export interface VersionTextRuntime {
  /** `process.version` — e.g. `v20.11.0`. */
  nodeVersion: string;
  /** `process.platform` — e.g. `darwin`, `linux`, `win32`. */
  platform: NodeJS.Platform;
  /** `process.arch` — e.g. `arm64`, `x64`. */
  arch: string;
}

/**
 * Build the human-readable text for the `/version` slash command.
 *
 * Shows the wizard's package.json version, the agent-mode NDJSON
 * protocol version, and the Node + platform runtime — i.e. everything
 * a user filing a bug report would otherwise have to dig out of a
 * shell. Pure (no I/O) so it can be unit-tested with fixed inputs.
 *
 * The protocol version pinned here is the framing-layer wire version
 * (`AGENT_EVENT_WIRE_VERSION`) — per-event `data_version` lives on
 * each NDJSON envelope at runtime and isn't surfaced in this summary.
 */
export function getVersionText(
  runtime: VersionTextRuntime = {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
  },
): string {
  const lines: string[] = [
    `Amplitude Wizard v${WIZARD_VERSION}`,
    `Agent-mode protocol: v${AGENT_EVENT_WIRE_VERSION}`,
    `Node: ${runtime.nodeVersion} (${runtime.platform} ${runtime.arch})`,
  ];
  return lines.join('\n');
}
