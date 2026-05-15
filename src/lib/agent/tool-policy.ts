/**
 * Bash / path allowlists, canUseTool gate, and authoritative PreToolUse hook.
 * Extracted from agent-interface.ts for Phase D of NEW_MIGRATION_PLAN.md.
 */
import path from 'path';
import { debug, logToFile } from '../../utils/debug';
import type { WizardOptions } from '../../utils/types';
import { analytics, captureWizardError } from '../../utils/analytics';
import type { HookCallback } from '../agent-hooks';
import { LINTING_TOOLS } from '../safe-tools';
import { scanBashCommandForDestructive } from '../safety-scanner';
import { toWizardToolDenyMessage } from '../wizard-tools/types';

/**
 * Maximum number of seconds the agent may sleep in a single Bash call.
 *
 * Long sleeps are the proximate cause of "API Error: 400 terminated" cascades:
 * the agent emits a Bash tool_use that idles the upstream API streaming
 * connection. The Amplitude LLM gateway / Vertex closes idle streams after
 * ~30s, the next API call returns 400, and the agent escalates by sleeping
 * even longer (3s → 5s → 10s → 30s → 60s) trying to "wait for MCP recovery".
 *
 * Capping at 5s keeps short, legitimate pauses (e.g. waiting for a brief
 * dev-server boot) working while breaking the runaway sleep loop.
 */
export const MAX_BASH_SLEEP_SECONDS = 5;

export const MAX_CONSECUTIVE_BASH_DENIES = 5;

/**
 * Maximum times the agent may call `wizard-tools:load_skill` for the same
 * skillId within a single agent run. Bodies are cached on the wizard side
 * (the file lives on disk in the wizard package), so repeat calls are
 * always pure waste — and historically a load_skill_menu → load_skill →
 * load_skill_menu loop has been observed in production traces (see the
 * "DISABLED" comment block in `wizard-tools.ts`).
 *
 * The limit is two: the model can re-fetch once after a long context
 * compaction without tripping the deny, but a tight succession of three
 * gets blocked with a clear "use the cached body" message that breaks
 * the loop instead of letting it burn turns.
 */
export const MAX_LOAD_SKILL_PER_ID = 2;

/** Matches `sleep <number>` at the start of a command or after a chain operator. */
const SLEEP_COMMAND_PATTERN = /(?:^|[;&|\n]\s*)\s*sleep\s+(\d+(?:\.\d+)?)/i;

/**
 * Executables that can be used to run build commands.
 * Includes package managers, language build tools, and static site generators.
 */
const PACKAGE_MANAGERS = [
  // JavaScript / Node
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'npx',
  'deno',
  // Python
  'pip',
  'pip3',
  'poetry',
  'pipenv',
  'uv',
  // Ruby
  'gem',
  'bundle',
  'bundler',
  'rake',
  // PHP
  'composer',
  // Go
  'go',
  // Rust
  'cargo',
  // Java / Kotlin / Android
  'gradle',
  './gradlew',
  'mvn',
  './mvnw',
  // .NET
  'dotnet',
  // Swift
  'swift',
  // Haskell
  'stack',
  'cabal',
  // Elixir
  'mix',
  // Flutter / Dart
  'flutter',
  'dart',
  // Make
  'make',
  // Static site generators
  'zola',
  'hugo',
  'jekyll',
  'eleventy',
  'hexo',
  'pelican',
  'mkdocs',
];

/**
 * Commands that are safe to run with no sub-command (the executable alone builds the project).
 */
const STANDALONE_BUILD_COMMANDS = ['hugo', 'make', 'eleventy'];

/**
 * Safe sub-commands/scripts that can be run with any executable in PACKAGE_MANAGERS.
 * Uses startsWith matching, so 'build' matches 'build', 'build:prod', etc.
 * Note: Linting tools are in LINTING_TOOLS and checked separately.
 */
const SAFE_SCRIPTS = [
  // Package / dependency installation
  'install',
  'add',
  'ci',
  'get',
  'restore',
  'fetch',
  'deps',
  'update',
  // Build / compile / generate
  'build',
  'compile',
  'assemble',
  'package',
  'generate',
  'bundle',
  // Type checking (various naming conventions)
  'tsc',
  'typecheck',
  'type-check',
  'check-types',
  'types',
  // Check / verify
  'check',
  // Test
  'test',
  // Serve (for build verification with static site tools)
  'serve',
  // Module / dependency management sub-commands
  'mod',
  'pub',
  // Make targets
  'all',
  // Linting/formatting script names (actual tools are in LINTING_TOOLS)
  'lint',
  'format',
];

/**
 * Dangerous shell operators that could allow command injection.
 * Note: We handle `2>&1` and `| tail/head` separately as safe patterns.
 * Note: `&&` is allowed for specific safe patterns like skill installation.
 */
const DANGEROUS_OPERATORS = /[;`$()]/;

/**
 * Read-only POSIX inspection commands that surface ~37% of "not in allowlist"
 * denies in production (Amplitude `wizard cli: bash deny circuit breaker
 * tripped` events, May 2026). Agents reach for these reflexively to confirm
 * a directory exists or print the current path; without an allow-path the
 * agent is forced to chain alternate shell incantations that trip the
 * `command not in allowlist` deny, then escalate into a circuit-breaker
 * trip after 5 consecutive denies.
 *
 * Each entry is a POSIX command that reads filesystem metadata and writes
 * nothing. We only allow the EXACT command shape declared here — any flag,
 * redirection, pipe, or shell metacharacter must still fall through to the
 * generic deny rules. The wider safety net (DANGEROUS_OPERATORS, pipe
 * deny, multiple-pipe deny, command-substitution deny) stays in place
 * before this allowlist is consulted.
 *
 * DELIBERATELY NOT INCLUDED:
 *   - `find` — `-exec`/`-execdir` is arbitrary code execution.
 *   - `cd` — stateful shell builtin; encourages `cd && <cmd>` patterns
 *     that would let chained commands bypass the per-token allowlist.
 *   - `cat` / `head -n <file>` / etc. — `Read` covers this and the
 *     `.env` file deny path lives at the Read tool, not Bash.
 *   - `grep` — `Grep` tool covers this and respects the `.env` deny.
 */
const READONLY_INSPECTION_COMMANDS: ReadonlySet<string> = new Set([
  'pwd',
  'ls',
]);

/**
 * Maximum length of a path argument we'll allow through the read-only
 * inspection allowlist. A 4 KB ceiling is well above any realistic
 * filesystem path (POSIX PATH_MAX is 4096) while keeping the
 * denial-of-service surface tiny.
 */
const MAX_INSPECTION_PATH_LENGTH = 4096;

/**
 * Check if a command is a strictly bounded, read-only inspection command
 * that we want to allow without forcing the agent through the Read/Glob
 * tools. Only matches:
 *
 *   pwd
 *   ls
 *   ls <single-path-arg>
 *
 * The path arg may be:
 *   - bare: `ls /Users/foo/proj`
 *   - double-quoted: `ls "/Users/foo/My Project"`
 *   - single-quoted: `ls '/Users/foo/My Project'`
 *
 * Any flag (token starting with `-`), any second positional, any shell
 * metacharacter (caught earlier), or any quote-with-embedded-quote is
 * rejected. The caller MUST run this check AFTER the DANGEROUS_OPERATORS
 * and pipe/background-operator denies so quote injection cannot smuggle a
 * second command past us.
 */
export function isReadOnlyInspectionCommand(command: string): boolean {
  const trimmed = command.trim();

  // Reject anything containing shell metacharacters even if a future
  // refactor reorders the check. Defense in depth — the caller already
  // denies on these, but a stray reorder shouldn't open a hole.
  if (/[;`$()|&<>\n\r]/.test(trimmed)) return false;

  // Zero-arg form: command stands alone (e.g. `pwd`, `ls`).
  if (READONLY_INSPECTION_COMMANDS.has(trimmed)) return true;

  // One-arg form: only `ls <path>` is supported. `pwd` takes no path arg.
  if (!trimmed.startsWith('ls ')) return false;

  const rest = trimmed.slice(3).trim();
  // Reject flag-shaped tokens. Even safe-looking flags like `-A` could in
  // theory accept additional positional args we don't validate — keep the
  // surface zero by rejecting all `-`/`--` tokens.
  if (rest.startsWith('-')) return false;
  if (rest.length === 0) return false;
  if (rest.length > MAX_INSPECTION_PATH_LENGTH) return false;

  // Quoted path: must be fully quoted with no embedded matching quote.
  if (rest.startsWith('"')) {
    if (!rest.endsWith('"')) return false;
    const inner = rest.slice(1, -1);
    if (inner.includes('"')) return false;
    // Inside double quotes, $/` expand. They're already rejected above,
    // but reject explicitly here for clarity.
    if (/[`$]/.test(inner)) return false;
    return inner.length > 0;
  }
  if (rest.startsWith("'")) {
    if (!rest.endsWith("'")) return false;
    const inner = rest.slice(1, -1);
    if (inner.includes("'")) return false;
    return inner.length > 0;
  }

  // Bare path: must be a single whitespace-free token. Multi-word paths
  // must be quoted (the production denial samples show agents already
  // quote multi-word user paths correctly).
  return !/\s/.test(rest);
}

/**
 * Check if command is a Amplitude skill installation from MCP.
 * We control the MCP server, so we only need to verify:
 * 1. It installs to .claude/skills/
 * 2. It downloads from our GitHub releases or localhost (dev)
 */
export function isSkillInstallCommand(command: string): boolean {
  if (!command.startsWith('mkdir -p .claude/skills/')) return false;

  const urlMatch = command.match(/curl -sL ['"]([^'"]+)['"]/);
  if (!urlMatch) return false;

  const url = urlMatch[1];
  return (
    url.startsWith('https://github.com/Amplitude/context-mill/releases/') ||
    /^http:\/\/localhost:\d+\//.test(url)
  );
}

/**
 * Strip a monorepo workspace selector prefix from a tokenized argv, returning
 * a new argv that looks like `<pkg-mgr> <rest>` so the standard allowlist
 * check can be applied. Returns null if the input is not a recognized
 * selector shape.
 *
 * Recognized selectors (one level only — nested selectors are intentionally
 * not supported to keep the surface small and prevent recursive bypass):
 *
 *   yarn workspace <name> <rest>            (Yarn 1 workspace selector)
 *   yarn workspaces foreach [-flags...] <rest>  (Yarn 2+ foreach selector)
 *   yarn --cwd <dir> <rest>                 (Yarn cwd flag)
 *   yarn -C <dir> <rest>                    (Yarn cwd short flag)
 *   pnpm --filter <name> <rest>             (pnpm filter)
 *   pnpm -F <name> <rest>                   (pnpm filter short)
 *   npm --workspace <ws> <rest>             (npm workspace flag)
 *   npm -w <ws> <rest>                      (npm workspace short)
 *   bun --cwd <dir> <rest>                  (bun cwd flag)
 *
 * After stripping, the returned argv keeps the original package-manager
 * token at parts[0] so the recursive `matchesAllowedPrefix` check sees a
 * normal `<pkg-mgr> <safe-script>` shape.
 */
function stripMonorepoSelector(parts: string[]): string[] | null {
  if (parts.length < 3) return null;
  const pm = parts[0];

  // yarn-family selectors
  if (pm === 'yarn') {
    // yarn workspaces foreach [flags...] <script...>
    if (parts[1] === 'workspaces' && parts[2] === 'foreach') {
      // Skip flags after `foreach` (anything starting with `-`).
      let i = 3;
      while (i < parts.length && parts[i].startsWith('-')) {
        i++;
      }
      if (i >= parts.length) return null;
      return [pm, ...parts.slice(i)];
    }
    // yarn workspace <name> <rest>
    if (parts[1] === 'workspace') {
      const name = parts[2];
      // Reject empty / flag-shaped selector names.
      if (!name || name.startsWith('-')) return null;
      if (parts.length < 4) return null;
      return [pm, ...parts.slice(3)];
    }
    // yarn --cwd <dir> <rest>  /  yarn -C <dir> <rest>
    if (parts[1] === '--cwd' || parts[1] === '-C') {
      const dir = parts[2];
      if (!dir || dir.startsWith('-')) return null;
      if (parts.length < 4) return null;
      return [pm, ...parts.slice(3)];
    }
    return null;
  }

  // pnpm --filter <name> <rest>  /  pnpm -F <name> <rest>
  if (pm === 'pnpm') {
    if (parts[1] === '--filter' || parts[1] === '-F') {
      const name = parts[2];
      if (!name || name.startsWith('-')) return null;
      if (parts.length < 4) return null;
      return [pm, ...parts.slice(3)];
    }
    return null;
  }

  // npm --workspace <ws> <rest>  /  npm -w <ws> <rest>
  if (pm === 'npm') {
    if (parts[1] === '--workspace' || parts[1] === '-w') {
      const ws = parts[2];
      if (!ws || ws.startsWith('-')) return null;
      if (parts.length < 4) return null;
      return [pm, ...parts.slice(3)];
    }
    return null;
  }

  // bun --cwd <dir> <rest>
  if (pm === 'bun') {
    if (parts[1] === '--cwd') {
      const dir = parts[2];
      if (!dir || dir.startsWith('-')) return null;
      if (parts.length < 4) return null;
      return [pm, ...parts.slice(3)];
    }
    return null;
  }

  return null;
}

/**
 * Check if command is an allowed package manager command.
 * Matches: <pkg-manager> [run|exec] <safe-script> [args...]
 *
 * Also recognizes one level of monorepo workspace selector
 * (`yarn workspace <name> ...`, `pnpm --filter <name> ...`,
 * `npm -w <ws> ...`, etc.) by stripping the selector and re-checking the
 * inner command. The recursion is guarded by `_depth` to allow exactly one
 * strip; nested selectors stay denied.
 */
export function matchesAllowedPrefix(command: string, _depth = 0): boolean {
  const parts = command.split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0 || !PACKAGE_MANAGERS.includes(parts[0])) {
    return false;
  }

  // Allow tools that are safe to invoke with no sub-command (e.g. `hugo`, `make`)
  if (parts.length === 1 && STANDALONE_BUILD_COMMANDS.includes(parts[0])) {
    return true;
  }

  // Skip 'run' or 'exec' if present
  let scriptIndex = 1;
  if (parts[scriptIndex] === 'run' || parts[scriptIndex] === 'exec') {
    scriptIndex++;
  }

  // Get the script/command portion (may include args)
  const scriptPart = parts.slice(scriptIndex).join(' ');

  // Check if script starts with any safe script name or linting tool
  const directMatch =
    SAFE_SCRIPTS.some((safe) => scriptPart.startsWith(safe)) ||
    LINTING_TOOLS.some((tool: string) => scriptPart.startsWith(tool));
  if (directMatch) return true;

  // Fallback: try stripping a single monorepo workspace selector and
  // re-checking the inner command. Depth guard prevents infinite recursion
  // on pathological inputs and intentionally disallows nested selectors.
  if (_depth === 0) {
    const stripped = stripMonorepoSelector(parts);
    if (stripped !== null) {
      return matchesAllowedPrefix(stripped.join(' '), 1);
    }
  }

  return false;
}

/**
 * Recognize the "background a package install + report PID" shell idiom
 * the wizard commandments instruct agents to use. Returns true ONLY when
 * the command matches one of:
 *
 *   <pkg-mgr> <safe-script> [args...] [2>&1] &
 *   <pkg-mgr> <safe-script> [args...] [2>&1] & echo "..."
 *   <pkg-mgr> <safe-script> [args...] [2>&1] &\necho "..."
 *
 * Where `<pkg-mgr> <safe-script>` is the same allowlist `matchesAllowedPrefix`
 * accepts (pnpm/npm/yarn/bun + add/install/etc.).
 *
 * The base command is checked for any other chaining/dangerous operators
 * before we approve, so commands like `pnpm add foo; rm -rf /` or
 * `pnpm add foo $(curl evil) &` still get caught by the deny rules below.
 */
export function isSafeBackgroundedInstall(command: string): boolean {
  // Strip stderr redirection (2>&1, 2>&2, 1>&2, …) so we can pattern-match
  // the underlying base command + & terminator.
  const stripped = command.replace(/\s*\d*>&\d+\s*/g, ' ').trim();

  // Split on the first `&` that backgrounds the command. The base must come
  // before the `&`; everything after is the (optional) trailer.
  const ampIdx = stripped.indexOf('&');
  if (ampIdx === -1) return false;
  const base = stripped.slice(0, ampIdx).trim();
  const trailer = stripped.slice(ampIdx + 1).trim();

  // Reject if the base contains any other shell metacharacter — the deny
  // rules below would catch them anyway, but checking here keeps the
  // decision local and explicit.
  if (/[;`$()|&]/.test(base)) return false;
  if (!matchesAllowedPrefix(base)) return false;

  // No trailer is fine: `pnpm add foo &`
  if (trailer === '') return true;

  // Trailer must be a single echo statement with safe content. Any other
  // structure (extra `&`, `;`, `|`, command substitution, backticks) is
  // rejected so we don't accidentally let through chained commands like
  // `pnpm add foo & echo ok; <chained>` or
  // `pnpm add foo & echo "$(curl evil.com)"`.
  //
  // Forbid these anywhere in the trailer, even inside quotes — bash expands
  // `$()`, `${...}`, and backticks inside double quotes.
  if (/[`;|&]/.test(trailer)) return false;
  if (/\$\(|\$\{/.test(trailer)) return false;

  // Strip ONE optional leading newline (literal `\n` or escaped `\\n`) so
  // patterns like `& \necho "..."` still validate. After this, no further
  // newlines are permitted: bash treats newlines as command terminators,
  // so any internal `\n` in the trailer would let an attacker append a
  // second command (e.g. `echo ok\ncurl evil.com`).
  const trimmed = trailer.replace(/^(?:\\n|\n)\s*/, '');
  if (/[\n\r]/.test(trimmed)) return false;

  // Single `echo` with EITHER:
  //   - a double-quoted string with no `$`-expansion except `$!`, `$?`, `$$`, or `$<digit>`
  //   - a single-quoted string (literal, no expansion)
  //   - bare alphanumeric/punctuation text (note: ` ` is the ONLY whitespace
  //     allowed here — `\s` would also match `\n` and re-open the bypass)
  const echoMatch = trimmed.match(
    /^echo +(?:"([^"]*)"|'([^']*)'|([A-Za-z0-9_:.,!?\-+/= ]*))$/,
  );
  if (!echoMatch) return false;

  const doubleQuoted = echoMatch[1];
  if (doubleQuoted !== undefined) {
    // Inside double quotes bash performs parameter expansion. We already
    // rejected `$(` and `${` above, so the only `$` patterns that can
    // appear are `$<char>`. Allow only the harmless special parameters
    // (`$!`, `$?`, `$$`, `$0`-`$9`); reject `$alpha` (env var leak risk).
    if (/\$[^!?$0-9]/.test(doubleQuoted)) return false;
  }

  return true;
}

const CAN_USE_TOOL_LOG_MAX_JSON_CHARS = 2400;

let canUseToolLogCounter = 0;

/**
 * Shrink large tool I/O before writing to the structured log file (every
 * `canUseTool` hit can carry multi‑KB MCP payloads).
 */
export function redactToolLogPayload(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.length <= CAN_USE_TOOL_LOG_MAX_JSON_CHARS) return value;
    return {
      _truncated: true,
      length: value.length,
      preview: `${value.slice(0, CAN_USE_TOOL_LOG_MAX_JSON_CHARS)}…`,
    };
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
  if (json.length <= CAN_USE_TOOL_LOG_MAX_JSON_CHARS) {
    return value;
  }
  const keys =
    !Array.isArray(value) && value !== null
      ? Object.keys(value as Record<string, unknown>).slice(0, 48)
      : undefined;
  return {
    _truncated: true,
    approxLength: json.length,
    keys,
    preview: `${json.slice(0, CAN_USE_TOOL_LOG_MAX_JSON_CHARS)}…`,
  };
}

/** Whether this `canUseTool` invocation should emit file logs (increments sample counter once). */
export function evaluateCanUseToolFileLogging(options: WizardOptions): boolean {
  const debugFlag =
    Boolean(options.debug) ||
    process.env.AMPLITUDE_WIZARD_DEBUG === '1' ||
    process.env.AMPLITUDE_WIZARD_VERBOSE === '1' ||
    process.env.AMPLITUDE_WIZARD_DEBUG_CAN_USE_TOOL === '1';
  const sampleRaw = process.env.AMPLITUDE_WIZARD_CAN_USE_TOOL_LOG_SAMPLE;
  const sampleEvery =
    sampleRaw !== undefined && sampleRaw !== ''
      ? Math.max(1, Number.parseInt(sampleRaw, 10) || 0)
      : 0;
  canUseToolLogCounter += 1;
  const sampled = sampleEvery > 0 && canUseToolLogCounter % sampleEvery === 0;
  return debugFlag || sampled;
}

/**
 * Permission hook that allows only safe commands.
 * - Package manager install commands
 * - Build/typecheck/lint commands for verification
 * - Piping to tail/head for output limiting is allowed
 * - Stderr redirection (2>&1) is allowed
 * - Amplitude skill installation commands from MCP
 * - Backgrounded package installs (`<pkg-mgr> add foo 2>&1 & echo "..."`)
 */
export function wizardCanUseTool(
  toolName: string,
  input: Record<string, unknown>,
):
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string } {
  // Block direct reads/writes of .env files — use wizard-tools MCP instead.
  // The full set of write tools is `Write`, `Edit`, `MultiEdit`, and
  // `NotebookEdit` — see classifyWriteOperation in agent-events.ts. Older
  // versions of this hook only matched `Write`/`Edit`, leaving MultiEdit
  // as a bypass path. Cover all four tools here.
  const isReadTool = toolName === 'Read';
  const isWriteTool =
    toolName === 'Write' ||
    toolName === 'Edit' ||
    toolName === 'MultiEdit' ||
    toolName === 'NotebookEdit';
  if (isReadTool || isWriteTool) {
    const filePath = typeof input.file_path === 'string' ? input.file_path : '';
    // Normalize path separators BEFORE computing basename. On POSIX, Node's
    // `path.basename` does not recognize `\` as a separator, so a Windows
    // path like `C:\\project\\.amplitude\\events.json` would basename to
    // the entire string and slip past our matchers. Normalizing to `/`
    // first means `path.basename` is correct on both platforms regardless
    // of which slash style the agent passed.
    const normalizedPath = filePath.replace(/\\/g, '/');
    const basename = path.basename(normalizedPath);
    if (basename.startsWith('.env')) {
      logToFile(`Denying ${toolName} on env file: ${filePath}`);
      return {
        behavior: 'deny',
        message: toWizardToolDenyMessage({
          error: `Direct ${toolName} of ${basename} is not allowed. Use the wizard-tools MCP server (check_env_keys / set_env_values) to read or modify environment variables.`,
          guidance: isReadTool
            ? `Call mcp__wizard-tools__check_env_keys with { filePath: "${basename}", keys: ["AMPLITUDE_API_KEY", ...] } to verify env-var presence without exposing values.`
            : `Call mcp__wizard-tools__set_env_values with { filePath: "${basename}", values: { "<KEY>": "<value>" } } to write env vars. The wizard manages .gitignore coverage and atomic merging for you.`,
          suggestedTool: isReadTool
            ? 'mcp__wizard-tools__check_env_keys'
            : 'mcp__wizard-tools__set_env_values',
          context: `denied tool: ${toolName}; denied path: ${filePath}`,
        }),
      };
    }
    // Block direct writes to the wizard-managed event-plan and dashboard
    // artifacts. These files are owned by `confirm_event_plan` and the
    // dashboard watcher — direct writes are the source of two recurring
    // bugs: (1) the file already exists from a prior run and Write errors
    // out (Write requires a prior Read of an existing file), forcing the
    // agent into a confused "stale file" recovery loop; (2) the agent
    // writes a different shape (event_name, file_path, etc.) than the
    // wizard UI expects, so the manifest drifts from real track() calls.
    // The integration skills owned by context-hub still instruct agents
    // to write `.amplitude-events.json` directly — denying here is
    // defense in depth that lands today, in advance of the upstream
    // skill refresh.
    if (isWriteTool) {
      const lower = basename.toLowerCase();
      const isEventsFile =
        lower === '.amplitude-events.json' || lower === 'events.json';
      // For the bare `events.json` / `dashboard.json` cases, only deny
      // when the path is inside `.amplitude/` (the wizard's metadata
      // dir). A user codebase might legitimately have an unrelated
      // `events.json` somewhere else. We use the already-normalized
      // path (forward slashes) computed at the top of this branch so
      // the substring check is consistent across POSIX and Windows.
      const insideMetaDir = normalizedPath.includes('/.amplitude/');
      const isLegacyDotfile =
        lower === '.amplitude-events.json' ||
        lower === '.amplitude-dashboard.json';
      const isCanonicalInMetaDir =
        (lower === 'events.json' || lower === 'dashboard.json') &&
        insideMetaDir;
      if (isLegacyDotfile || isCanonicalInMetaDir) {
        const which = isEventsFile ? 'event plan' : 'dashboard';
        const tool =
          which === 'event plan'
            ? 'mcp__wizard-tools__confirm_event_plan'
            : 'mcp__wizard-tools__record_dashboard';
        const humanTool =
          which === 'event plan'
            ? 'mcp__wizard-tools__confirm_event_plan'
            : 'the dashboard watcher (which mirrors writes from the Amplitude MCP `create_dashboard` call)';
        logToFile(
          `Denying ${toolName} on wizard-managed ${which} file: ${filePath}`,
        );
        const guidance =
          which === 'event plan'
            ? `Call mcp__wizard-tools__confirm_event_plan with the proposed events; it persists the canonical file shape so the wizard UI and manifest stay in sync. If a stale ${basename} is on disk from a prior run, ignore it — confirm_event_plan atomically replaces it.`
            : `Call mcp__wizard-tools__record_dashboard with the dashboard URL after the Amplitude MCP \`create_dashboard\` returns. The wizard mirrors the file write for you.`;
        return {
          behavior: 'deny',
          message: toWizardToolDenyMessage({
            error: `Direct ${toolName} of ${basename} is not allowed. The ${which} file is owned by ${humanTool}.`,
            guidance,
            suggestedTool: tool,
            context: `denied tool: ${toolName}; denied path: ${filePath}`,
          }),
        };
      }
    }
    return { behavior: 'allow', updatedInput: input };
  }

  // Block Grep when it directly targets a .env file.
  // Note: ripgrep skips dotfiles (like .env*) by default during directory traversal,
  // so broad searches like `Grep { path: "." }` are already safe.
  if (toolName === 'Grep') {
    const grepPath = typeof input.path === 'string' ? input.path : '';
    if (grepPath && path.basename(grepPath).startsWith('.env')) {
      const grepBasename = path.basename(grepPath);
      logToFile(`Denying Grep on env file: ${grepPath}`);
      return {
        behavior: 'deny',
        message: toWizardToolDenyMessage({
          error: `Grep on ${grepBasename} is not allowed.`,
          guidance: `Call mcp__wizard-tools__check_env_keys with { filePath: "${grepBasename}", keys: ["<KEY>", ...] } to verify presence without exposing values.`,
          suggestedTool: 'mcp__wizard-tools__check_env_keys',
          context: `denied path: ${grepPath}`,
        }),
      };
    }
    return { behavior: 'allow', updatedInput: input };
  }

  // Allow all other non-Bash tools
  if (toolName !== 'Bash') {
    return { behavior: 'allow', updatedInput: input };
  }

  const command = (
    typeof input.command === 'string' ? input.command : ''
  ).trim();

  // Check for Amplitude skill installation command (before dangerous operator check)
  // These commands use && chaining but are generated by MCP with a strict format
  if (isSkillInstallCommand(command)) {
    logToFile(`Allowing skill installation command: ${command}`);
    debug(`Allowing skill installation command: ${command}`);
    return { behavior: 'allow', updatedInput: input };
  }

  // Allow the specific shell idiom the commandments tell agents to use:
  // `<pkg-mgr> add/install ... [2>&1] & [echo "..."]`.
  //
  // The wizard commandment in src/lib/commandments.ts says "When installing
  // packages, start the installation as a background task and then continue
  // with other work." Agents follow this by emitting:
  //   `pnpm add @amplitude/unified 2>&1 & echo "Installation started (PID: $!)"`
  // …which contains `&` (background) and `$()` (in the echo string), both of
  // which the generic deny rules below would catch. We pre-approve this
  // specific pattern so the agent can actually do what the commandment
  // tells it to do, without weakening the deny rules for other commands.
  //
  // Backwards-compat: every existing deny rule below stays in place and
  // unchanged. This is purely an additional allow path.
  if (isSafeBackgroundedInstall(command)) {
    logToFile(`Allowing backgrounded package install: ${command}`);
    debug(`Allowing backgrounded package install: ${command}`);
    return { behavior: 'allow', updatedInput: input };
  }

  // Newer Claude Agent SDK builds expose `run_in_background: true` as a
  // first-class Bash tool input — the SDK forks the process in the
  // background instead of the agent appending `&` to the command string.
  // This is the SAFER variant of the same idiom (no shell metacharacter,
  // no echo trailer with `$!`) and the commandment explicitly tells
  // agents to background installs. When the agent picks this path, treat
  // it as if it had emitted `<command> &` and run the same allow-list
  // check we use for the explicit-`&` form.
  if (
    input.run_in_background === true &&
    matchesAllowedPrefix(command) &&
    !DANGEROUS_OPERATORS.test(command) &&
    !/[|&]/.test(command.replace(/\s*\d*>&\d+\s*/g, ' '))
  ) {
    logToFile(`Allowing run_in_background package-manager command: ${command}`);
    debug(`Allowing run_in_background package-manager command: ${command}`);
    return { behavior: 'allow', updatedInput: input };
  }

  // Block definitely dangerous operators: ; ` $ ( )
  if (DANGEROUS_OPERATORS.test(command)) {
    logToFile(`Denying bash command with dangerous operators: ${command}`);
    debug(`Denying bash command with dangerous operators: ${command}`);
    captureWizardError(
      'Bash Policy',
      'Dangerous shell operators are not permitted',
      'wizardCanUseBash',
      { 'deny reason': 'dangerous operators', command },
    );
    return {
      behavior: 'deny',
      message: toWizardToolDenyMessage({
        error: `Bash command denied by wizard policy: shell operators ; \` $ ( ) are not permitted on this run, and no rephrasing will change that.`,
        guidance: `DO NOT retry the same goal with a different command — see the retry-budget commandment. If you were verifying env vars, use mcp__wizard-tools__check_env_keys. If you were inspecting a file, use the Read tool. If you cannot accomplish the goal with the allowed tools, document the limitation in the setup report and proceed.`,
        suggestedTool: 'Read',
        context: `denied command: ${command}`,
      }),
    };
  }

  // Normalize: remove safe stderr redirection (2>&1, 2>&2, etc.)
  const normalized = command.replace(/\s*\d*>&\d+\s*/g, ' ').trim();

  // Check for pipe to tail/head (safe output limiting)
  const pipeMatch = normalized.match(/^(.+?)\s*\|\s*(tail|head)(\s+\S+)*\s*$/);
  if (pipeMatch) {
    const baseCommand = pipeMatch[1].trim();

    // Block if base command has pipes or & (multiple chaining)
    if (/[|&]/.test(baseCommand)) {
      logToFile(`Denying bash command with multiple pipes: ${command}`);
      debug(`Denying bash command with multiple pipes: ${command}`);
      captureWizardError(
        'Bash Policy',
        'Multiple pipes are not permitted',
        'wizardCanUseBash',
        { 'deny reason': 'multiple pipes', command },
      );
      return {
        behavior: 'deny',
        message: toWizardToolDenyMessage({
          error: `Bash command denied by wizard policy: only a single pipe to tail/head is permitted (no chained pipes).`,
          guidance: `This is a fixed policy — DO NOT retry the same goal with a re-ordered or differently-piped command. Use one allowed package-manager subcommand at a time. For substring filtering, capture the output and use the Grep tool on the file instead.`,
          suggestedTool: 'Grep',
          context: `denied command: ${command}`,
        }),
      };
    }

    if (matchesAllowedPrefix(baseCommand)) {
      logToFile(`Allowing bash command with output limiter: ${command}`);
      debug(`Allowing bash command with output limiter: ${command}`);
      return { behavior: 'allow', updatedInput: input };
    }
  }

  // Block remaining pipes and & (not covered by tail/head case above)
  if (/[|&]/.test(normalized)) {
    logToFile(`Denying bash command with pipe/&: ${command}`);
    debug(`Denying bash command with pipe/&: ${command}`);
    captureWizardError(
      'Bash Policy',
      'Pipes are only allowed with tail/head',
      'wizardCanUseBash',
      { 'deny reason': 'disallowed pipe', command },
    );
    return {
      behavior: 'deny',
      message: toWizardToolDenyMessage({
        error: `Bash command denied by wizard policy: pipes are only permitted as \`<allowed-command> | tail/head <args>\` for output limiting; \`&\` (background) and other pipe forms are not permitted.`,
        guidance: `DO NOT retry with a re-piped variant. Run the package-manager subcommand by itself, or pipe to a single \`| tail -50\` / \`| head -30\` for output limiting. If you cannot accomplish the goal with allowed tools, document the limitation in the setup report and proceed.`,
        context: `denied command: ${command}`,
      }),
    };
  }

  // Check if command starts with any allowed prefix (package manager commands)
  if (matchesAllowedPrefix(normalized)) {
    logToFile(`Allowing bash command: ${command}`);
    debug(`Allowing bash command: ${command}`);
    return { behavior: 'allow', updatedInput: input };
  }

  // Allow strictly bounded read-only inspection commands (`pwd`, `ls`,
  // `ls <single-path>`). Production telemetry (Amplitude `wizard cli:
  // bash deny circuit breaker tripped`, May 2026) showed agents reach
  // for `ls "/Users/foo/proj/"` to confirm a directory exists; without
  // this allow path the deny cascade burns turns and trips the 5-deny
  // circuit breaker that halts the run. Placed AFTER the dangerous-
  // operator / pipe / multi-pipe denies above so quote injection,
  // command substitution, and chaining are already rejected before we
  // get here. `isReadOnlyInspectionCommand` also re-rejects the same
  // metacharacters as defense in depth.
  if (isReadOnlyInspectionCommand(normalized)) {
    logToFile(`Allowing read-only inspection command: ${command}`);
    debug(`Allowing read-only inspection command: ${command}`);
    return { behavior: 'allow', updatedInput: input };
  }

  logToFile(`Denying bash command: ${command}`);
  debug(`Denying bash command: ${command}`);
  captureWizardError(
    'Bash Policy',
    'Command not in allowlist',
    'wizardCanUseBash',
    { 'deny reason': 'not in allowlist', command },
  );
  return {
    behavior: 'deny',
    message: toWizardToolDenyMessage({
      error: `Bash command denied by wizard policy: only package-manager subcommands (install / add / build / test / typecheck / lint / format / etc.), \`pwd\`, \`ls\` / \`ls <path>\` (no flags), and Amplitude skill installs are permitted.`,
      guidance: `DO NOT retry the same goal with a different shell command — \`node -e\`, \`node --eval\`, \`printenv\`, \`echo $VAR\`, \`cat .env\`, \`bash -c '...'\`, \`find ... -exec\`, etc. will all be denied. To verify env vars use mcp__wizard-tools__check_env_keys; to inspect a file use Read; to inspect a directory use Glob (or \`ls <path>\` with no flags); to search code use Grep. If you cannot accomplish the goal with the allowed tools, document the limitation in the setup report and proceed.`,
      suggestedTool: 'Read',
      context: `denied command: ${command}`,
    }),
  };
}

/**
 * Build a PreToolUse hook that enforces wizard Bash safety.
 *
 * Why this exists: the Claude Agent SDK runs with
 * `tools: { type: 'preset', preset: 'claude_code' }` and
 * `permissionMode: 'acceptEdits'`. In that configuration, `canUseTool` is
 * NOT invoked for the built-in `Bash` tool — only for MCP tools. Logs from
 * production runs confirm zero `canUseTool` entries for Bash even though
 * `wizardCanUseTool` is wired into options.
 *
 * PreToolUse hooks fire unconditionally for every tool, so this is the
 * authoritative place to gate Bash. We delegate the canonical allowlist
 * to `wizardCanUseTool` and additionally cap `sleep <N>` to
 * MAX_BASH_SLEEP_SECONDS to break the 400-terminated sleep cascade.
 *
 * On top of the gate, the hook tracks consecutive Bash denies and trips a
 * circuit breaker after MAX_CONSECUTIVE_BASH_DENIES. Prompt-side guidance
 * ("DO NOT retry") reduces the rate of looping but doesn't eliminate it —
 * a user reported a 47-turn loop on the same denied command. The breaker
 * is the belt-and-suspenders enforcement that fires when the model ignores
 * the prompt anyway. Trip callback is one-shot per hook instance; the
 * counter resets on any allowed Bash call so legitimate deny → recover
 * sequences don't trip falsely.
 */
export interface PreToolUseHookOptions {
  /**
   * Invoked exactly once per hook instance, when consecutive Bash denies
   * reach MAX_CONSECUTIVE_BASH_DENIES. Caller should treat as a terminal
   * signal (e.g. trigger `wizardAbort`). Synchronous throws from this
   * callback are swallowed; async failures are the caller's responsibility.
   */
  onCircuitBreakerTripped?: (info: {
    consecutiveDenies: number;
    lastCommand: string;
    lastDenyReason: string;
  }) => void;
}

export function createPreToolUseHook(
  options: PreToolUseHookOptions = {},
): HookCallback {
  let consecutiveBashDenies = 0;
  let circuitBreakerFired = false;
  // Per-skillId call counts for the tiered `load_skill` tool. Scoped to
  // the lifetime of this hook instance, which matches the lifetime of a
  // single agent run — that's our "phase" per the rollout spec. Tracking
  // by skillId (not just total calls) means the agent CAN load multiple
  // distinct skills, just not re-fetch the same body in a loop.
  const loadSkillCalls = new Map<string, number>();

  /**
   * Wrap a Bash deny return value with circuit-breaker bookkeeping.
   * Increments the counter, fires the trip callback once at threshold,
   * returns the original deny payload unchanged so the SDK still respects
   * the deny decision while wizardAbort tears the run down.
   */
  const trackBashDeny = (
    denyPayload: Record<string, unknown>,
    command: string,
    reason: string,
  ): Record<string, unknown> => {
    consecutiveBashDenies += 1;
    if (
      consecutiveBashDenies >= MAX_CONSECUTIVE_BASH_DENIES &&
      !circuitBreakerFired
    ) {
      circuitBreakerFired = true;
      logToFile(
        `Circuit breaker tripped after ${consecutiveBashDenies} consecutive Bash denies; last command: ${command}`,
      );
      captureWizardError(
        'Bash Policy',
        'Circuit breaker tripped',
        'createPreToolUseHook',
        {
          'consecutive denies': consecutiveBashDenies,
          'last command': command,
          'last deny reason': reason,
        },
      );
      try {
        options.onCircuitBreakerTripped?.({
          consecutiveDenies: consecutiveBashDenies,
          lastCommand: command,
          lastDenyReason: reason,
        });
      } catch (err) {
        logToFile(
          `onCircuitBreakerTripped threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return denyPayload;
  };

  return (input: Record<string, unknown>) => {
    const toolName = (input.tool_name as string | undefined) ?? '';
    const toolInput =
      (input.tool_input as Record<string, unknown> | undefined) ?? {};

    // Surface the agent's intent on every wizard-tools MCP call. The
    // `reason` field is required by every wizard-tools schema (see
    // wizard-tools.ts) — capturing it here gives us instant visibility in
    // our existing dashboards alongside Agent Analytics' track_tool_call().
    // Tools without `reason` (Bash, Read, Edit, plus other MCP servers)
    // are skipped so we don't pollute the event with empty fields.
    if (toolName.startsWith('mcp__wizard-tools__')) {
      const reason = toolInput.reason;
      if (typeof reason === 'string' && reason.length > 0) {
        const shortName = toolName.slice('mcp__wizard-tools__'.length);
        analytics.wizardCapture('tool invoked', {
          'tool name': shortName,
          reason,
        });
      }
    }

    // Tier-2 `load_skill` loop detection. The body lives on disk inside
    // the wizard package — once fetched, the agent already has it in
    // context. A 3rd call for the same id always indicates either a
    // load_skill_menu → load_skill → load_skill_menu loop (the legacy
    // pattern that motivated disabling the original menu/install tools)
    // or context that was lost across a compaction we can't help with.
    // Either way, denying with a clear "use what you already have"
    // message is strictly better than letting the loop burn turns.
    if (toolName === 'mcp__wizard-tools__load_skill') {
      const skillId =
        typeof toolInput.skillId === 'string' ? toolInput.skillId : '';
      if (skillId) {
        const count = (loadSkillCalls.get(skillId) ?? 0) + 1;
        loadSkillCalls.set(skillId, count);
        if (count > MAX_LOAD_SKILL_PER_ID) {
          const reason = `load_skill for "${skillId}" has already been called ${
            count - 1
          } times in this run (cap is ${MAX_LOAD_SKILL_PER_ID}). The skill body is in your context — re-read your earlier tool result instead of re-fetching. If you need a different skill, call load_skill with a different skillId.`;
          logToFile(
            `Denying load_skill loop on "${skillId}" (call #${count}): ${reason}`,
          );
          captureWizardError(
            'Skill Tier Policy',
            'load_skill loop detected',
            'createPreToolUseHook',
            {
              'skill id': skillId,
              'call count': count,
              cap: MAX_LOAD_SKILL_PER_ID,
            },
          );
          return Promise.resolve({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: reason,
            },
          });
        }
      }
    }

    // Run the explicit destructive-command blocklist BEFORE the canonical
    // allowlist check. Both deny these commands, but the allowlist deny
    // message is generic ("command not in allowlist") which invites the
    // model to retry rephrased variants of the same destructive intent.
    // The scanner emits a specific "this is destructive policy, abandon
    // this path" message that breaks the retry loop. Fail-closed on
    // scanner exception (the catch returns deny).
    if (toolName === 'Bash') {
      const command =
        typeof toolInput.command === 'string' ? toolInput.command : '';
      try {
        const scan = scanBashCommandForDestructive(command);
        if (scan.matched && scan.rule) {
          logToFile(
            `Denying destructive bash command (rule: ${scan.rule.label}): ${command}`,
          );
          captureWizardError(
            'Bash Policy',
            `Destructive command blocked: ${scan.rule.label}`,
            'createPreToolUseHook',
            { 'rule id': scan.rule.id, command },
          );
          const structured = toWizardToolDenyMessage({
            error: `Destructive bash command blocked (rule: ${scan.rule.label}).`,
            guidance: scan.rule.message,
            context: `denied command: ${command}; rule id: ${scan.rule.id}`,
          });
          return Promise.resolve(
            trackBashDeny(
              {
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse',
                  permissionDecision: 'deny',
                  permissionDecisionReason: structured,
                },
              },
              command,
              scan.rule.message,
            ),
          );
        }
      } catch (err) {
        // Fail-closed: a scanner exception is a block decision. The only
        // realistic source of throws is regex backtracking on pathological
        // input, and on those we'd rather block than pass.
        logToFile('Destructive-bash scanner threw; failing closed:', err);
        const reason =
          'Bash command blocked by safety scanner due to an internal error. Re-attempting with the same command will produce the same result. Skip this step or take a different approach.';
        const structured = toWizardToolDenyMessage({
          error: 'Bash command blocked by safety scanner (internal error).',
          guidance: reason,
          context: `denied command: ${command}`,
        });
        return Promise.resolve(
          trackBashDeny(
            {
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: structured,
              },
            },
            command,
            reason,
          ),
        );
      }
    }

    // Cap long sleeps before the canonical allowlist check, so the
    // diagnostic message is specific instead of "command not in allowlist".
    if (toolName === 'Bash') {
      const command =
        typeof toolInput.command === 'string' ? toolInput.command : '';
      const match = command.match(SLEEP_COMMAND_PATTERN);
      if (match) {
        const seconds = Number.parseFloat(match[1]);
        if (Number.isFinite(seconds) && seconds > MAX_BASH_SLEEP_SECONDS) {
          logToFile(
            `Denying long sleep (${seconds}s > ${MAX_BASH_SLEEP_SECONDS}s): ${command}`,
          );
          captureWizardError(
            'Bash Policy',
            'Long sleep blocked',
            'createPreToolUseHook',
            { 'sleep seconds': seconds, command },
          );
          const reason = `Bash sleep > ${MAX_BASH_SLEEP_SECONDS}s is not permitted. Long sleeps idle the upstream API stream and trigger "API Error: 400 terminated" cascades. If a service appears unavailable, do NOT wait — proceed with the next step or report the failure.`;
          const structured = toWizardToolDenyMessage({
            error: `Bash sleep > ${MAX_BASH_SLEEP_SECONDS}s is not permitted.`,
            guidance: `Long sleeps idle the upstream API stream and trigger "API Error: 400 terminated" cascades. If a service appears unavailable, do NOT wait — proceed with the next step or call mcp__wizard-tools__report_status with kind="error" and an appropriate code.`,
            suggestedTool: 'mcp__wizard-tools__report_status',
            context: `denied command: ${command}; sleep seconds: ${seconds}; cap: ${MAX_BASH_SLEEP_SECONDS}s`,
          });
          return Promise.resolve(
            trackBashDeny(
              {
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse',
                  permissionDecision: 'deny',
                  permissionDecisionReason: structured,
                },
              },
              command,
              reason,
            ),
          );
        }
      }
    }

    // Delegate to the canonical allowlist. Apply to Bash here; for other
    // tools (Read/Write/Edit/Grep on .env, MCP tools) we keep canUseTool
    // as the primary gate since it already runs reliably for those.
    if (toolName === 'Bash') {
      const command =
        typeof toolInput.command === 'string' ? toolInput.command : '';
      const decision = wizardCanUseTool(toolName, toolInput);
      if (decision.behavior === 'deny') {
        // `decision.message` is a JSON-shaped structured deny envelope
        // (see toWizardToolDenyMessage). The structured payload is
        // correct for the agent (`permissionDecisionReason`), but the
        // circuit-breaker / analytics `lastDenyReason` wants a plain
        // human-readable string. Extract `guidance` (or fall back to
        // `error`) so analytics see the same shape the other three
        // trackBashDeny call sites use.
        let humanReason = decision.message;
        try {
          const parsed = JSON.parse(decision.message) as {
            guidance?: string;
            error?: string;
          };
          humanReason = parsed.guidance ?? parsed.error ?? decision.message;
        } catch {
          // Not JSON — keep the raw message.
        }
        return Promise.resolve(
          trackBashDeny(
            {
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: decision.message,
              },
            },
            command,
            humanReason,
          ),
        );
      }
      // Allowed Bash call — reset the consecutive-deny counter so a
      // future deny → success → deny sequence doesn't accumulate falsely.
      // The breaker is for a stuck agent, not for incidental denies
      // sprinkled across an otherwise-progressing run.
      consecutiveBashDenies = 0;
    }

    return Promise.resolve({});
  };
}
