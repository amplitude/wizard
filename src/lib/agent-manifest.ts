/**
 * agent-manifest — Machine-readable description of the CLI surface.
 *
 * Exposed via `amplitude-wizard help --json` so AI coding agents can
 * introspect the available commands, flags, env vars, and exit codes
 * without parsing human help text.
 *
 * Kept hand-maintained (rather than auto-generated from yargs internals)
 * so it stays a stable contract that changes only intentionally.
 */

export interface CommandFlag {
  name: string;
  describe: string;
  type: 'string' | 'boolean' | 'number';
  default?: string | boolean | number;
}

export interface CommandEntry {
  command: string;
  describe: string;
  flags?: CommandFlag[];
  subcommands?: CommandEntry[];
  outputs?: 'human' | 'json' | 'ndjson' | 'both';
}

export interface AgentManifest {
  schemaVersion: 1;
  bin: string;
  /** npm package name, for `npx <package>` invocation. */
  package: string;
  /**
   * Ordered list of ways to invoke the CLI. The first entry is the
   * recommended form — agents should use it unless they know the CLI
   * is globally installed. Each entry is an argv prefix that precedes
   * the verb and flags (e.g. `[...invocation, 'detect', '--json']`).
   */
  invocations: Array<{
    argv: string[];
    describe: string;
    requiresGlobalInstall: boolean;
  }>;
  description: string;
  globalFlags: CommandFlag[];
  env: Array<{ name: string; describe: string }>;
  exitCodes: Array<{ code: number; name: string; describe: string }>;
  commands: CommandEntry[];
  ndjsonSchemaVersion: 1;
}

export function getAgentManifest(): AgentManifest {
  return {
    schemaVersion: 1,
    bin: 'amplitude-wizard',
    package: '@amplitude/wizard',
    invocations: [
      {
        argv: ['npx', '@amplitude/wizard'],
        describe: 'Works without installation (recommended for agents)',
        requiresGlobalInstall: false,
      },
      {
        argv: ['amplitude-wizard'],
        describe: 'Direct bin — requires `npm install -g @amplitude/wizard`',
        requiresGlobalInstall: true,
      },
    ],
    description:
      'Interactive CLI that instruments apps with Amplitude analytics.',
    globalFlags: [
      {
        name: '--agent',
        describe:
          'NDJSON output, auto-approve prompts (best for AI coding agents)',
        type: 'boolean',
        default: false,
      },
      {
        name: '--json',
        describe:
          'Emit machine-readable JSON output (implied when piped). Unlike --agent, does not auto-approve prompts.',
        type: 'boolean',
        default: false,
      },
      {
        name: '--human',
        describe: 'Force human-readable output (overrides --json auto-detect)',
        type: 'boolean',
        default: false,
      },
      {
        name: '--ci',
        describe: 'Run non-interactively (alias: --yes, -y)',
        type: 'boolean',
        default: false,
      },
      {
        name: '--api-key',
        describe: 'Amplitude API key (skips browser login)',
        type: 'string',
      },
      {
        name: '--install-dir',
        describe: 'Project directory to inspect or instrument',
        type: 'string',
      },
      {
        name: '--debug',
        describe: 'Enable debug logging',
        type: 'boolean',
        default: false,
      },
    ],
    env: [
      {
        name: 'AMPLITUDE_TOKEN',
        describe:
          'OAuth access-token override (requires prior `amplitude-wizard login`)',
      },
      {
        name: 'AMPLITUDE_WIZARD_TOKEN',
        describe: 'Alias for AMPLITUDE_TOKEN',
      },
      {
        name: 'AMPLITUDE_WIZARD_API_KEY',
        describe: 'Amplitude project API key (alias of --api-key)',
      },
      {
        name: 'AMPLITUDE_WIZARD_AGENT',
        describe: 'Set to 1 to force agent mode (NDJSON output, auto-approve)',
      },
      {
        name: 'AMPLITUDE_WIZARD_DEBUG',
        describe: 'Set to 1 to enable debug logging',
      },
      {
        name: 'AMPLITUDE_WIZARD_LOG',
        describe: 'Path to write logs to',
      },
      {
        name: 'AMPLITUDE_WIZARD_ALLOW_NESTED',
        describe:
          'Set to 1 to skip the nested-invocation diagnostic. The wizard sanitizes inherited Claude env vars either way, so nesting works by default.',
      },
    ],
    exitCodes: [
      { code: 0, name: 'SUCCESS', describe: 'Completed successfully' },
      { code: 1, name: 'GENERAL_ERROR', describe: 'Unclassified error' },
      { code: 2, name: 'INVALID_ARGS', describe: 'Invalid flags or arguments' },
      {
        code: 3,
        name: 'AUTH_REQUIRED',
        describe: 'Not logged in; run `amplitude-wizard login` first',
      },
      {
        code: 4,
        name: 'NETWORK_ERROR',
        describe: 'Could not reach Amplitude or a required service',
      },
      {
        code: 10,
        name: 'AGENT_FAILED',
        describe: 'The AI-powered setup agent failed mid-run',
      },
      {
        code: 130,
        name: 'USER_CANCELLED',
        describe: 'User cancelled (Ctrl-C or prompt rejection)',
      },
    ],
    commands: [
      {
        command: '(default)',
        describe: 'Run the full interactive setup wizard',
        outputs: 'human',
      },
      {
        command: 'detect',
        describe: 'Detect the framework used in the current project',
        outputs: 'both',
        flags: [
          {
            name: '--install-dir',
            describe: 'Project directory to inspect',
            type: 'string',
          },
        ],
      },
      {
        command: 'status',
        describe:
          'Report project setup state: framework, SDK installed, API key, auth',
        outputs: 'both',
        flags: [
          {
            name: '--install-dir',
            describe: 'Project directory to inspect',
            type: 'string',
          },
        ],
      },
      {
        command: 'auth status',
        describe: 'Show current login state',
        outputs: 'both',
      },
      {
        command: 'auth token',
        describe: 'Print the stored OAuth access token to stdout (for scripts)',
        outputs: 'both',
      },
      {
        command: 'login',
        describe: 'Authenticate with Amplitude via browser OAuth',
        outputs: 'human',
      },
      {
        command: 'logout',
        describe: 'Clear stored credentials',
        outputs: 'human',
      },
      {
        command: 'whoami',
        describe: 'Show logged-in user (legacy; prefer `auth status --json`)',
        outputs: 'human',
      },
      {
        command: 'mcp add',
        describe: 'Install the Amplitude MCP server into your editor',
        outputs: 'human',
      },
      {
        command: 'mcp remove',
        describe: 'Remove the Amplitude MCP server from your editor',
        outputs: 'human',
      },
      {
        command: 'mcp serve',
        describe:
          'Run the Amplitude wizard MCP server on stdio (for AI coding agents)',
        outputs: 'json',
      },
      {
        command: 'manifest',
        describe: 'Print this machine-readable CLI manifest',
        outputs: 'json',
      },
      {
        command: 'completion',
        describe: 'Print shell completion script for bash/zsh',
        outputs: 'human',
      },
    ],
    ndjsonSchemaVersion: 1,
  };
}
