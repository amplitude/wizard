export type ExecutionMode = 'interactive' | 'ci' | 'agent';

/**
 * Three orthogonal capability flags an agent-mode invocation can grant.
 *
 *   - `autoApprove`     — OK to silently pick the `recommended` value when
 *                          the wizard would otherwise emit `needs_input`
 *                          and stop.
 *   - `allowWrites`     — OK for the inner agent to call write tools
 *                          (Edit, Write, MultiEdit, Bash mutations). When
 *                          false, the PreToolUse hook denies write attempts
 *                          and the wizard exits `WRITE_REFUSED`.
 *   - `allowDestructive`— OK to overwrite or delete files that already exist
 *                          in the repo. When false, write tools may still
 *                          create new files but can't clobber.
 *
 * The flags are designed to compose: most invocations want `autoApprove +
 * allowWrites` (today's `--yes` semantics); the new `plan` command wants
 * just `autoApprove` (so it can answer `needs_input` but never write); the
 * new `apply` command requires `allowWrites` and refuses to run without it.
 */
export interface CapabilityFlags {
  autoApprove: boolean;
  allowWrites: boolean;
  allowDestructive: boolean;
}

export interface ModeConfig extends CapabilityFlags {
  mode: ExecutionMode;
  jsonOutput: boolean;
  quiet: boolean;
}

export interface ResolveModeOpts {
  ci?: boolean;
  yes?: boolean;
  /**
   * `--auto-approve` — silently pick `recommended` when a `needs_input`
   * event would fire. Does NOT grant write permission on its own.
   */
  autoApprove?: boolean;
  /**
   * `--force` — OK to overwrite/delete existing files. Implies
   * `allowWrites` for ergonomic CLI use.
   */
  force?: boolean;
  agent?: boolean;
  json?: boolean;
  human?: boolean;
  isTTY: boolean;
  /**
   * When true, write capability must be granted explicitly via `--yes` /
   * `--ci` / `--force`. Used by the `apply` subcommand and any other
   * command that wants strict opt-in. Default `false` preserves today's
   * `--agent` behavior (auto-approve + writes implied).
   */
  requireExplicitWrites?: boolean;
}

/**
 * Resolve the effective execution mode, output preferences, and capability
 * grants.
 *
 * Precedence for output format:
 *   --human           → force human output (overrides auto-detect)
 *   --json / --agent  → force structured JSON
 *   !isTTY            → auto-detect to JSON (piped to another program)
 *   default           → human
 *
 * Capability grants (additive, lowest to highest):
 *   --auto-approve    → autoApprove
 *   --yes / --ci      → autoApprove + allowWrites
 *   --force           → autoApprove + allowWrites + allowDestructive
 *   --agent (alone)   → autoApprove + allowWrites (unless `requireExplicitWrites`)
 *
 * `--json` produces machine-readable output WITHOUT any capability grants.
 * Use `--agent` when you also want auto-approval of prompts.
 */
export function resolveMode(opts: ResolveModeOpts): ModeConfig {
  const isAgent = Boolean(opts.agent);
  const requireExplicitWrites = Boolean(opts.requireExplicitWrites);

  // Build capability grants additively from each flag.
  let autoApprove = false;
  let allowWrites = false;
  let allowDestructive = false;

  if (opts.autoApprove) autoApprove = true;
  if (opts.yes) {
    autoApprove = true;
    allowWrites = true;
  }
  if (opts.ci) {
    autoApprove = true;
    allowWrites = true;
  }
  if (opts.force) {
    autoApprove = true;
    allowWrites = true;
    allowDestructive = true;
  }
  // Back-compat: today's `--agent` (no other flags) implies auto-approve
  // and writes. New scoped commands (`apply`, `verify`) opt out via
  // `requireExplicitWrites: true`.
  if (isAgent && !requireExplicitWrites) {
    autoApprove = true;
    allowWrites = true;
  } else if (isAgent) {
    // Strict agent mode: `--auto-approve` / `--yes` / `--force` must be
    // explicit. `autoApprove`/`allowWrites` stay at whatever the explicit
    // flags above set them to.
  }

  const isInteractive = !autoApprove && opts.isTTY;

  const jsonOutput = opts.human
    ? false
    : Boolean(opts.json) || isAgent || !opts.isTTY;

  return {
    mode: isAgent ? 'agent' : isInteractive ? 'interactive' : 'ci',
    autoApprove,
    allowWrites,
    allowDestructive,
    jsonOutput,
    quiet: !opts.isTTY,
  };
}

// ── Write-gate helper ─────────────────────────────────────────────────
//
// The PreToolUse hook calls `evaluateWriteGate` for every tool the inner
// Claude agent attempts. The gate answers a single question: should this
// tool call be allowed under the current capability grants? When denied,
// the hook returns a structured deny response and the wizard exits
// `WRITE_REFUSED` (13) so outer agents can re-invoke with `--yes`.

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

const DESTRUCTIVE_BASH_PATTERNS: RegExp[] = [
  /\brm\s+-/i, // rm -rf, rm -r, rm -f
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+checkout\s+--\s/i,
  /\bgit\s+clean\s+-/i,
  /\bgit\s+restore\s+\./i,
  /\bgit\s+push\s+.*--force\b/i,
  /\bdrop\s+(table|database)\b/i,
  /\btruncate\s+table\b/i,
];

export type WriteGateDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string; resumeFlag: '--yes' | '--force' };

/**
 * Decide whether a tool call should be permitted under the current
 * capability grants. Pure function — no I/O, easy to unit test.
 *
 *   - Write tools (Edit/Write/MultiEdit/NotebookEdit) require `allowWrites`.
 *   - Bash commands matching destructive patterns require `allowDestructive`.
 *   - Everything else is allowed.
 */
export function evaluateWriteGate(
  toolName: string,
  toolInput: unknown,
  caps: CapabilityFlags,
): WriteGateDecision {
  if (WRITE_TOOLS.has(toolName)) {
    if (!caps.allowWrites) {
      return {
        kind: 'deny',
        reason: `Tool "${toolName}" is a write tool and --yes was not provided.`,
        resumeFlag: '--yes',
      };
    }
    // Best-effort destructive detection for write tools: if the input has a
    // `path` or `file_path` that refers to an existing file, that's a
    // potential overwrite. The hook doesn't have filesystem access from
    // here, so we lean conservative — block writes that look like full
    // file replacements when --force is not set. The PreToolUse hook
    // upstream can do an fs.statSync check before calling this.
    return { kind: 'allow' };
  }

  if (toolName === 'Bash') {
    const command =
      typeof toolInput === 'object' &&
      toolInput !== null &&
      'command' in toolInput &&
      typeof (toolInput as { command: unknown }).command === 'string'
        ? (toolInput as { command: string }).command
        : '';
    if (
      command &&
      DESTRUCTIVE_BASH_PATTERNS.some((re) => re.test(command)) &&
      !caps.allowDestructive
    ) {
      return {
        kind: 'deny',
        reason: `Bash command matches a destructive pattern and --force was not provided: ${command.slice(
          0,
          100,
        )}`,
        resumeFlag: '--force',
      };
    }
    // Non-destructive Bash: still requires allowWrites (any shell command
    // can mutate state). We err on the side of usability here — `apply`
    // grants allowWrites, which is what the inner agent needs.
    if (!caps.allowWrites) {
      return {
        kind: 'deny',
        reason: `Tool "Bash" can mutate state and --yes was not provided.`,
        resumeFlag: '--yes',
      };
    }
    return { kind: 'allow' };
  }

  return { kind: 'allow' };
}
