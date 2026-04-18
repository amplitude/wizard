export type ExecutionMode = 'interactive' | 'ci' | 'agent';

export interface ModeConfig {
  mode: ExecutionMode;
  autoApprove: boolean;
  jsonOutput: boolean;
  quiet: boolean;
}

export interface ResolveModeOpts {
  ci?: boolean;
  yes?: boolean;
  agent?: boolean;
  json?: boolean;
  human?: boolean;
  isTTY: boolean;
}

/**
 * Resolve the effective execution mode and output preferences.
 *
 * Precedence for output format:
 *   --human           → force human output (overrides auto-detect)
 *   --json / --agent  → force structured JSON
 *   !isTTY            → auto-detect to JSON (piped to another program)
 *   default           → human
 *
 * `--json` produces machine-readable output WITHOUT the other agent-mode
 * side effects (auto-approve, no TUI). Use `--agent` when you also want
 * auto-approval of all prompts.
 */
export function resolveMode(opts: ResolveModeOpts): ModeConfig {
  const isAgent = Boolean(opts.agent);
  const autoApprove = Boolean(opts.yes) || Boolean(opts.ci) || isAgent;
  const isInteractive = !autoApprove && opts.isTTY;

  const jsonOutput = opts.human
    ? false
    : Boolean(opts.json) || isAgent || !opts.isTTY;

  const config: ModeConfig = {
    mode: isAgent ? 'agent' : isInteractive ? 'interactive' : 'ci',
    autoApprove,
    jsonOutput,
    quiet: !opts.isTTY,
  };

  _activeMode = config.mode;
  return config;
}

// Module-level store of the resolved mode so header/trace builders scattered
// across the codebase can read it without threading ModeConfig through every
// call signature.
let _activeMode: ExecutionMode | null = null;

/** Read the mode resolved by the most recent resolveMode() call. */
export function getExecutionMode(): ExecutionMode {
  return _activeMode ?? 'interactive';
}

/**
 * Manually set the resolved mode. Used by early bootstrap code that needs to
 * pre-populate the header-builder state before yargs runs its handlers.
 */
export function setExecutionMode(mode: ExecutionMode): void {
  _activeMode = mode;
}
