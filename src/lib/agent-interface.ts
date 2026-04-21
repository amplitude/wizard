/**
 * Shared agent interface for Amplitude wizards
 * Uses Claude Agent SDK directly with Amplitude LLM gateway
 */

import path from 'path';
import * as fs from 'fs';
import { getUI, type SpinnerHandle } from '../ui';
import { debug, logToFile, initLogFile, getLogFilePath } from '../utils/debug';
import type { WizardOptions } from '../utils/types';
import { analytics, captureWizardError } from '../utils/analytics';
import {
  AMPLITUDE_PROPERTY_HEADER_PREFIX,
  WIZARD_VARIANT_FLAG_KEY,
  WIZARD_VARIANTS,
  WIZARD_USER_AGENT,
} from './constants';
import {
  type AdditionalFeature,
  ADDITIONAL_FEATURE_PROMPTS,
} from './wizard-session';
import { registerCleanup } from '../utils/wizard-abort';
import { createCustomHeaders } from '../utils/custom-headers';
import { getLlmGatewayUrlFromHost, getHostFromRegion } from '../utils/urls';
import { getStoredToken } from '../utils/ampli-settings';
import { LINTING_TOOLS } from './safe-tools';
import { AgentState, buildRecoveryNote, consumeSnapshot } from './agent-state';
import {
  createWizardToolsServer,
  WIZARD_TOOL_NAMES,
  type StatusReport,
  type StatusReporter,
} from './wizard-tools';
import { getWizardCommandments } from './commandments';
import { sanitizeNestedClaudeEnv } from './sanitize-claude-env';
import type { PackageManagerDetector } from './package-manager-detection';

import { z } from 'zod';
import type { SDKMessage } from './middleware/types';
import { safeParseSDKMessage } from './middleware/schemas';
import {
  type HookCallback,
  type HookCallbackMatcher,
  type HookEvent,
  buildHooksConfig,
} from './agent-hooks';

type SDKQueryOptions = {
  model?: string;
  fallbackModel?: string;
  cwd?: string;
  permissionMode?: string;
  mcpServers?: McpServersConfig;
  settingSources?: string[];
  allowedTools?: string[];
  systemPrompt?: unknown;
  env?: Record<string, string | undefined>;
  canUseTool?: (toolName: string, input: unknown) => Promise<unknown>;
  tools?: unknown;
  stderr?: (data: string) => void;
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  abortSignal?: AbortSignal;
  maxTurns?: number;
};

type SDKQueryFn = (params: {
  prompt: string | AsyncIterable<unknown>;
  options?: SDKQueryOptions;
}) => AsyncIterable<unknown>;

// Dynamic import cache for ESM module
let _sdkModule: { query: SDKQueryFn } | null = null;
async function getSDKModule(): Promise<{ query: SDKQueryFn }> {
  if (!_sdkModule) {
    const mod = await import('@anthropic-ai/claude-agent-sdk');
    _sdkModule = { query: mod.query as SDKQueryFn };
  }
  return _sdkModule;
}

/**
 * Get the path to the bundled Claude Code CLI from the SDK package.
 * This ensures we use the SDK's bundled version rather than the user's installed Claude Code.
 */
function getClaudeCodeExecutablePath(): string {
  // require.resolve finds the package's main entry, then we get cli.js from same dir
  const sdkPackagePath = require.resolve('@anthropic-ai/claude-agent-sdk');
  return path.join(path.dirname(sdkPackagePath), 'cli.js');
}

type McpServersConfig = Record<string, unknown>;

export const AgentSignals = {
  /**
   * Signal emitted when the agent provides a remark about its run.
   * Kept as a text marker because it bookends a multi-line reflection that
   * the model writes into its final message; structured tool-call routing
   * doesn't fit the free-form nature of the reflection payload.
   */
  WIZARD_REMARK: '[WIZARD-REMARK]',
  /** Signal prefix for benchmark logging */
  BENCHMARK: '[BENCHMARK]',
} as const;

export type AgentSignal = (typeof AgentSignals)[keyof typeof AgentSignals];

/**
 * Error types that can be returned from agent execution.
 * These correspond to the error signals that the agent emits.
 */
export enum AgentErrorType {
  /** Agent could not access the Amplitude MCP server */
  MCP_MISSING = 'WIZARD_MCP_MISSING',
  /** Agent could not access the setup resource */
  RESOURCE_MISSING = 'WIZARD_RESOURCE_MISSING',
  /** API rate limit exceeded */
  RATE_LIMIT = 'WIZARD_RATE_LIMIT',
  /** Generic API error */
  API_ERROR = 'WIZARD_API_ERROR',
  /** Authentication failed — bearer token invalid or expired */
  AUTH_ERROR = 'WIZARD_AUTH_ERROR',
}

const BLOCKING_ENV_KEYS = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN'];

// Active StatusReporter slot. runAgent sets this at the start of each attempt
// and clears it afterwards so the in-process wizard-tools `report_status` tool
// can route structured events back into the per-run state bag.
let _activeStatusReporter: StatusReporter | undefined;

/**
 * Check if .claude/settings.json in the project directory contains env
 * overrides for blocking keys that block the Wizard from accessing the Amplitude LLM Gateway.
 * Returns the list of matched key names, or an empty array if none found.
 */
export function checkClaudeSettingsOverrides(
  workingDirectory: string,
): string[] {
  const candidates = [
    path.join(workingDirectory, '.claude', 'settings.json'),
    path.join(workingDirectory, '.claude', 'settings'),
  ];

  const claudeSettingsSchema = z.object({
    env: z.record(z.string(), z.unknown()),
  });

  for (const filePath of candidates) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const result = claudeSettingsSchema.safeParse(JSON.parse(raw));
      if (result.success) {
        return BLOCKING_ENV_KEYS.filter((key) => key in result.data.env);
      }
    } catch {
      // File doesn't exist or isn't valid JSON — skip
    }
  }

  return [];
}

/**
 * Copy .claude/settings.json to .wizard-backup (overwriting if it exists),
 * then remove the original so the SDK doesn't load the blocking overrides.
 */
export function backupAndFixClaudeSettings(workingDirectory: string): boolean {
  for (const name of ['settings.json', 'settings']) {
    const filePath = path.join(workingDirectory, '.claude', name);
    const backupPath = `${filePath}.wizard-backup`;
    analytics.wizardCapture('claude settings backed up');
    try {
      fs.copyFileSync(filePath, backupPath);
      fs.unlinkSync(filePath);
      registerCleanup(() => {
        try {
          restoreClaudeSettings(workingDirectory);
        } catch (error) {
          analytics.captureException(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      });
      return true;
    } catch {
      // File doesn't exist — try next candidate
    }
  }
  return false;
}

/**
 * Restore .claude/settings.json from .wizard-backup.
 * Copies (not moves) so the backup is preserved.
 */
export function restoreClaudeSettings(workingDirectory: string): void {
  for (const name of ['settings.json', 'settings']) {
    const backup = path.join(
      workingDirectory,
      '.claude',
      `${name}.wizard-backup`,
    );
    try {
      fs.copyFileSync(backup, path.join(workingDirectory, '.claude', name));
      analytics.wizardCapture('claude settings restored');
      return;
    } catch (error) {
      analytics.captureException(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
}

export type AgentConfig = {
  workingDirectory: string;
  amplitudeMcpUrl: string;
  amplitudeApiKey: string;
  amplitudeBearerToken: string;
  amplitudeApiHost: string;
  additionalMcpServers?: Record<string, { url: string }>;
  detectPackageManager: PackageManagerDetector;
  /** Feature flag key -> variant (evaluated at start of run). */
  wizardFlags?: Record<string, string>;
  wizardMetadata?: Record<string, string>;
  /** When true, omit the amplitude-wizard MCP server (e.g. for generic/quickstart path). */
  skipAmplitudeMcp?: boolean;
  /** Remote skills URL. When set, skills are downloaded instead of using bundled copies. */
  skillsBaseUrl?: string;
};

/**
 * Create a stop hook callback that drains the additional feature queue,
 * then collects a remark, then allows stop.
 *
 * Three-phase logic using closure state:
 *   Phase 1 — drain queue: block with each feature prompt in order
 *   Phase 2 — collect remark (once): block with remark prompt
 *   Phase 3 — allow stop: return {}
 *
 * If `isAuthError()` returns true, all phases are skipped and stop is
 * allowed immediately — the agent cannot respond when auth has failed.
 */
export function createStopHook(
  featureQueue: readonly AdditionalFeature[],
  isAuthError: () => boolean = () => false,
): HookCallback {
  let featureIndex = 0;
  let remarkRequested = false;

  return (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const stop_hook_active = input.stop_hook_active as boolean;
    logToFile('Stop hook triggered', {
      stop_hook_active,
      featureIndex,
      remarkRequested,
      queueLength: featureQueue.length,
    });

    // If an auth error occurred, allow stop immediately — the agent cannot
    // make further API calls to process feature prompts or reflection requests.
    if (isAuthError()) {
      logToFile('Stop hook: allowing stop (auth error detected)');
      return Promise.resolve({});
    }

    // Phase 1: drain feature queue
    if (featureIndex < featureQueue.length) {
      const feature = featureQueue[featureIndex++];
      const prompt = ADDITIONAL_FEATURE_PROMPTS[feature];
      logToFile(`Stop hook: injecting feature prompt for ${feature}`);
      return Promise.resolve({ decision: 'block', reason: prompt });
    }

    // Phase 2: collect remark (once)
    if (!remarkRequested) {
      remarkRequested = true;
      logToFile('Stop hook: requesting reflection');
      return Promise.resolve({
        decision: 'block',
        reason: `Before concluding, provide a brief remark about what information or guidance would have been useful to have in the integration prompt or documentation for this run. Specifically cite anything that would have prevented tool failures, erroneous edits, or other wasted turns. Format your response exactly as: ${AgentSignals.WIZARD_REMARK} Your remark here`,
      });
    }

    // Phase 3: allow stop
    logToFile('Stop hook: allowing stop');
    return Promise.resolve({});
  };
}

/**
 * Factory: UserPromptSubmit hook — hydrates recovery context after a
 * compaction.
 *
 * If a PreCompact snapshot exists at `state.serializationPath()`, the hook
 * consumes it (reads + deletes) and returns `additionalContext` that
 * prepends a short recovery note listing modified files and the last
 * status. The snapshot is deleted so hydration fires at most once per
 * compaction cycle.
 *
 * When no snapshot exists (first turn, or no compaction has happened) the
 * hook is a no-op and returns `{}` so the SDK uses the prompt unchanged.
 */
export function createUserPromptSubmitHook(state: AgentState): HookCallback {
  return (
    _input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const snap = consumeSnapshot(state.serializationPath());
    if (!snap) return Promise.resolve({});

    const note = buildRecoveryNote(snap);
    logToFile(
      `UserPromptSubmit: hydrated recovery note (${snap.modifiedFiles.length} files, compactionCount=${snap.compactionCount})`,
    );
    return Promise.resolve({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: note,
      },
    });
  };
}

/**
 * Configuration object returned by initializeAgent / getAgent.
 */
export type AgentRunConfig = {
  workingDirectory: string;
  mcpServers: McpServersConfig;
  model: string;
  wizardFlags?: Record<string, string>;
  wizardMetadata?: Record<string, string>;
  /** When true, bypass the Amplitude gateway and run via the local `claude` CLI. */
  useLocalClaude?: boolean;
  /** When true, ANTHROPIC_API_KEY is passed through to the SDK instead of the gateway. */
  useDirectApiKey?: boolean;
};

const GATEWAY_LIVENESS_TIMEOUT_MS = 8_000;

/**
 * Ping the gateway URL with a short timeout.
 * Any HTTP response (even 4xx/5xx) means the gateway is reachable.
 * A timeout or connection error means it's down.
 */
async function checkGatewayLiveness(gatewayUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), GATEWAY_LIVENESS_TIMEOUT_MS);
  try {
    await fetch(gatewayUrl, { method: 'HEAD', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Select wizard metadata from WIZARD_VARIANTS using the variant feature flag.
 * If the flag is missing or the value is not in config, returns the "base" variant (VARIANT: "base").
 */
export function buildWizardMetadata(
  flags: Record<string, string> = {},
): Record<string, string> {
  const variantKey = flags[WIZARD_VARIANT_FLAG_KEY];
  const variant =
    (variantKey && WIZARD_VARIANTS[variantKey]) ?? WIZARD_VARIANTS['base'];
  return { ...variant };
}

/**
 * Build env for the SDK subprocess: process.env plus ANTHROPIC_CUSTOM_HEADERS from wizard metadata/flags.
 */
function buildAgentEnv(
  wizardMetadata: Record<string, string>,
  wizardFlags: Record<string, string>,
): string {
  const headers = createCustomHeaders();
  for (const [key, value] of Object.entries(wizardMetadata)) {
    headers.add(
      key.startsWith(AMPLITUDE_PROPERTY_HEADER_PREFIX)
        ? key
        : `${AMPLITUDE_PROPERTY_HEADER_PREFIX}${key}`,
      value,
    );
  }
  for (const [flagKey, variant] of Object.entries(wizardFlags)) {
    if (!flagKey.toLowerCase().startsWith('wizard')) continue;
    headers.addFlag(flagKey, variant);
  }
  const encoded = headers.encode();
  logToFile('ANTHROPIC_CUSTOM_HEADERS', encoded);
  return encoded;
}

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
 * Check if command is an allowed package manager command.
 * Matches: <pkg-manager> [run|exec] <safe-script> [args...]
 */
export function matchesAllowedPrefix(command: string): boolean {
  const parts = command.split(/\s+/);
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
  return (
    SAFE_SCRIPTS.some((safe) => scriptPart.startsWith(safe)) ||
    LINTING_TOOLS.some((tool) => scriptPart.startsWith(tool))
  );
}

/**
 * Permission hook that allows only safe commands.
 * - Package manager install commands
 * - Build/typecheck/lint commands for verification
 * - Piping to tail/head for output limiting is allowed
 * - Stderr redirection (2>&1) is allowed
 * - Amplitude skill installation commands from MCP
 */
export function wizardCanUseTool(
  toolName: string,
  input: Record<string, unknown>,
):
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string } {
  // Block direct reads/writes of .env files — use wizard-tools MCP instead
  if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') {
    const filePath = typeof input.file_path === 'string' ? input.file_path : '';
    const basename = path.basename(filePath);
    if (basename.startsWith('.env')) {
      logToFile(`Denying ${toolName} on env file: ${filePath}`);
      return {
        behavior: 'deny',
        message: `Direct ${toolName} of ${basename} is not allowed. Use the wizard-tools MCP server (check_env_keys / set_env_values) to read or modify environment variables.`,
      };
    }
    return { behavior: 'allow', updatedInput: input };
  }

  // Block Grep when it directly targets a .env file.
  // Note: ripgrep skips dotfiles (like .env*) by default during directory traversal,
  // so broad searches like `Grep { path: "." }` are already safe.
  if (toolName === 'Grep') {
    const grepPath = typeof input.path === 'string' ? input.path : '';
    if (grepPath && path.basename(grepPath).startsWith('.env')) {
      logToFile(`Denying Grep on env file: ${grepPath}`);
      return {
        behavior: 'deny',
        message: `Grep on ${path.basename(
          grepPath,
        )} is not allowed. Use the wizard-tools MCP server (check_env_keys) to check environment variables.`,
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
      message: `Bash command not allowed. Shell operators like ; \` $ ( ) are not permitted.`,
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
        message: `Bash command not allowed. Only single pipe to tail/head is permitted.`,
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
      message: `Bash command not allowed. Pipes are only permitted with tail/head for output limiting.`,
    };
  }

  // Check if command starts with any allowed prefix (package manager commands)
  if (matchesAllowedPrefix(normalized)) {
    logToFile(`Allowing bash command: ${command}`);
    debug(`Allowing bash command: ${command}`);
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
    message: `Bash command not allowed. Only install, build, typecheck, lint, and formatting commands are permitted.`,
  };
}

/**
 * Initialize agent configuration for the LLM gateway
 */
export async function initializeAgent(
  config: AgentConfig,
  options: WizardOptions,
): Promise<AgentRunConfig> {
  // Initialize log file for this run
  initLogFile();
  logToFile('Agent initialization starting');
  logToFile('Install directory:', options.installDir);

  // Strip inherited Claude Code / Agent SDK env vars before the inner SDK
  // subprocess boots. Without this, an outer Claude Code session's
  // CLAUDECODE=1, CLAUDE_CODE_ENTRYPOINT, CLAUDE_CODE_OAUTH_TOKEN, etc. leak
  // into the child and cause the LLM gateway to reject requests (400).
  const sanitized = sanitizeNestedClaudeEnv();
  if (sanitized.cleared.length > 0) {
    logToFile(
      'Sanitized inherited Claude env vars (nested-invocation safe):',
      sanitized.cleared,
    );
  }

  getUI().log.step('Initializing Claude agent...');

  try {
    const useDirectApiKey = !!process.env.ANTHROPIC_API_KEY;
    const useLocalClaude = !config.amplitudeBearerToken && !useDirectApiKey;

    if (useDirectApiKey) {
      // An inherited ANTHROPIC_AUTH_TOKEN from an outer agent session would
      // override ANTHROPIC_API_KEY in some SDK paths. Clear it so the user's
      // explicit API key wins unambiguously.
      delete process.env.ANTHROPIC_AUTH_TOKEN;
      logToFile('ANTHROPIC_API_KEY found — bypassing Amplitude gateway');
    } else if (useLocalClaude) {
      // The local claude CLI has its own auth; inherited ANTHROPIC_AUTH_TOKEN
      // from an outer session would route requests with the wrong credentials.
      delete process.env.ANTHROPIC_AUTH_TOKEN;
      logToFile('No Amplitude API key — using local claude CLI');
    } else {
      // Configure LLM gateway environment variables (inherited by SDK subprocess)
      const gatewayUrl = getLlmGatewayUrlFromHost(config.amplitudeApiHost);

      // Fail fast if the gateway isn't responding rather than hanging indefinitely
      const alive = await checkGatewayLiveness(gatewayUrl);
      if (!alive) {
        throw new Error(
          `Could not reach the Amplitude LLM gateway (${gatewayUrl}). ` +
            `Check your network connection, or set ANTHROPIC_API_KEY to use the Anthropic API directly.`,
        );
      }

      // Capture the pre-existing beta header state before we override it below,
      // so the diagnostic log reflects what the user's environment had configured.
      const betaHeadersEnabledInEnv =
        !process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS;

      process.env.ANTHROPIC_BASE_URL = gatewayUrl;
      process.env.ANTHROPIC_AUTH_TOKEN = config.amplitudeBearerToken;
      // Use CLAUDE_CODE_OAUTH_TOKEN to override any stored /login credentials
      process.env.CLAUDE_CODE_OAUTH_TOKEN = config.amplitudeBearerToken;
      // Disable experimental betas (like input_examples) that the LLM gateway doesn't support
      process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = 'true';
      logToFile('Configured LLM gateway:', gatewayUrl);
      logToFile('Gateway config:', {
        url: gatewayUrl,
        betaHeadersEnabledInEnv,
      });
    }

    // Configure MCP servers
    const mcpServers: McpServersConfig = {};

    if (!config.skipAmplitudeMcp) {
      mcpServers['amplitude-wizard'] = {
        type: 'http',
        url: config.amplitudeMcpUrl,
        headers: {
          Authorization: `Bearer ${config.amplitudeBearerToken}`,
          'User-Agent': WIZARD_USER_AGENT,
        },
      };
    }

    for (const [name, { url }] of Object.entries(
      config.additionalMcpServers ?? {},
    )) {
      mcpServers[name] = { type: 'http', url };
    }

    // Add in-process wizard tools (env files, package manager detection).
    // The status reporter is wired up per-run by runAgent via setStatusReporter.
    const wizardToolsServer = await createWizardToolsServer({
      workingDirectory: config.workingDirectory,
      detectPackageManager: config.detectPackageManager,
      skillsBaseUrl: config.skillsBaseUrl,
      statusReporter: () => _activeStatusReporter,
    });
    mcpServers['wizard-tools'] = wizardToolsServer;

    const agentRunConfig: AgentRunConfig = {
      workingDirectory: config.workingDirectory,
      mcpServers,
      // Gateway expects 'anthropic/claude-sonnet-4-6'; direct Anthropic API expects 'claude-sonnet-4-6'
      model: useDirectApiKey
        ? 'claude-sonnet-4-6'
        : 'anthropic/claude-sonnet-4-6',
      wizardFlags: config.wizardFlags,
      wizardMetadata: config.wizardMetadata,
      useLocalClaude,
      useDirectApiKey,
    };

    logToFile('Agent config:', {
      workingDirectory: agentRunConfig.workingDirectory,
      amplitudeMcpUrl: config.amplitudeMcpUrl,
      useLocalClaude,
      useDirectApiKey,
      bearerTokenPresent: !!config.amplitudeBearerToken,
    });

    if (options.debug) {
      debug('Agent config:', {
        workingDirectory: agentRunConfig.workingDirectory,
        amplitudeMcpUrl: config.amplitudeMcpUrl,
        useLocalClaude,
        useDirectApiKey,
        bearerTokenPresent: !!config.amplitudeBearerToken,
      });
    }

    getUI().log.step(`Verbose logs: ${getLogFilePath()}`);
    getUI().log.success("Agent initialized. Let's get cooking!");
    return agentRunConfig;
  } catch (error) {
    logToFile('Agent initialization error:', error);
    debug('Agent initialization error:', error);
    throw error;
  }
}

let _agentPromise: Promise<AgentRunConfig> | null = null;

function buildDefaultAgentConfig(): AgentConfig {
  const storedToken = getStoredToken()?.accessToken ?? '';
  const host = getHostFromRegion('us');
  const mcpUrl = process.env.MCP_URL ?? 'https://mcp.amplitude.com/mcp';
  return {
    workingDirectory: process.cwd(),
    amplitudeMcpUrl: mcpUrl,
    amplitudeApiKey: storedToken,
    amplitudeBearerToken: storedToken,
    amplitudeApiHost: host,
    skipAmplitudeMcp: !storedToken,
    detectPackageManager: () =>
      Promise.resolve({ detected: [], primary: null, recommendation: '' }),
  };
}

const DEFAULT_WIZARD_OPTIONS: WizardOptions = {
  debug: false,
  forceInstall: false,
  installDir: process.cwd(),
  default: false,
  signup: false,
  localMcp: false,
  ci: false,
  menu: false,
  benchmark: false,
};

/**
 * Return the already-initialized agent config, or call initializeAgent to create it.
 * Concurrent calls during initialization share the same Promise.
 * On error the cached Promise is cleared so the next call retries.
 *
 * Omitting config/options reads the bearer token from ~/.ampli.json and uses production
 * defaults (MCP disabled if no token found, cwd as working directory).
 */
export async function getAgent(
  config: AgentConfig = buildDefaultAgentConfig(),
  options: WizardOptions = DEFAULT_WIZARD_OPTIONS,
): Promise<AgentRunConfig> {
  if (!_agentPromise) {
    _agentPromise = initializeAgent(config, options).catch((err) => {
      _agentPromise = null;
      throw err;
    });
  }
  return _agentPromise;
}

/**
 * Run the agent by spawning the user's local `claude` CLI with --continue.
 * Used when no Amplitude API key is present (local development).
 * Streams stdout line-by-line and forwards text to the spinner.
 */
export async function runAgentLocally(
  prompt: string,
  workingDirectory: string,
  spinner: SpinnerHandle,
  successMessage: string,
  errorMessage: string,
): Promise<{ error?: AgentErrorType; message?: string }> {
  const { spawn } = await import('child_process');

  logToFile('Running agent via local claude CLI');

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['--continue', prompt], {
      cwd: workingDirectory,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');

    proc.stdout.on('data', (chunk: string) => {
      const lines = chunk.split('\n').filter((l) => l.trim());
      for (const line of lines) {
        logToFile('claude stdout:', line);
        spinner.message(line.slice(0, 80));
        getUI().pushStatus(line.slice(0, 80));
      }
    });

    proc.stderr.on('data', (chunk: string) => {
      logToFile('claude stderr:', chunk);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        spinner.stop(successMessage);
        resolve({});
      } else {
        spinner.stop(errorMessage);
        reject(new Error(`claude exited with code ${code ?? 'unknown'}`));
      }
    });

    proc.on('error', (err) => {
      spinner.stop(errorMessage);
      reject(err);
    });
  });
}

/**
 * Execute an agent with the provided prompt and options
 * Handles the full lifecycle: spinner, execution, error handling
 *
 * @returns An object containing any error detected in the agent's output
 */
export async function runAgent(
  agentConfig: AgentRunConfig,
  prompt: string,
  options: WizardOptions,
  spinner: SpinnerHandle,
  config?: {
    estimatedDurationMinutes?: number;
    spinnerMessage?: string;
    successMessage?: string;
    errorMessage?: string;
    additionalFeatureQueue?: readonly AdditionalFeature[];
  },
  middleware?: {
    onMessage(message: SDKMessage): void;
    finalize(resultMessage: SDKMessage, totalDurationMs: number): unknown;
  },
): Promise<{ error?: AgentErrorType; message?: string }> {
  const {
    spinnerMessage = 'Customizing your Amplitude setup...',
    successMessage = 'Amplitude integration complete',
    errorMessage = 'Integration failed',
  } = config ?? {};

  spinner.start(spinnerMessage);

  if (agentConfig.useLocalClaude) {
    return runAgentLocally(
      prompt,
      agentConfig.workingDirectory,
      spinner,
      successMessage,
      errorMessage,
    );
  }

  const { query } = await getSDKModule();

  const cliPath = getClaudeCodeExecutablePath();
  logToFile('Starting agent run');
  logToFile('Claude Code executable:', cliPath);
  logToFile('Prompt:', prompt);

  const startTime = Date.now();
  const collectedText: string[] = [];
  const recentStatuses: string[] = []; // rolling last-3 STATUS messages for heartbeat
  // Track if we received a successful result (before any cleanup errors)
  let receivedSuccessResult = false;
  let lastResultMessage: SDKMessage | null = null;

  // Workaround for SDK bug: stdin closes before canUseTool responses can be sent.
  // The fix is to use an async generator for the prompt that stays open until
  // the result is received, keeping the stdin stream alive for permission responses.
  // signalDone is reassigned each retry attempt — the outer catch always has the latest.
  // See: https://github.com/anthropics/claude-code/issues/4775
  // See: https://github.com/anthropics/claude-agent-sdk-typescript/issues/41
  let signalDone: () => void = Function.prototype as () => void;

  // Helper to handle successful completion (used in normal path and race condition recovery)
  const completeWithSuccess = (
    suppressedError?: Error,
  ): { error?: AgentErrorType; message?: string } => {
    const durationMs = Date.now() - startTime;
    const durationSeconds = Math.round(durationMs / 1000);

    if (suppressedError) {
      logToFile(
        `Ignoring post-completion error, agent completed successfully in ${durationSeconds}s`,
      );
      logToFile('Suppressed error:', suppressedError.message);
    } else {
      logToFile(`Agent run completed in ${durationSeconds}s`);
    }

    // Extract and capture the agent's reflection on the run
    const outputText = collectedText.join('\n');
    const remarkRegex = new RegExp(
      `${AgentSignals.WIZARD_REMARK.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&',
      )}\\s*(.+?)(?:\\n|$)`,
      's',
    );
    const remarkMatch = outputText.match(remarkRegex);
    if (remarkMatch && remarkMatch[1]) {
      const remark = remarkMatch[1].trim();
      if (remark) {
        analytics.wizardCapture('wizard remark', { remark });
      }
    }

    analytics.wizardCapture('agent completed', {
      'duration ms': durationMs,
      'duration seconds': durationSeconds,
    });
    try {
      if (lastResultMessage) {
        middleware?.finalize(lastResultMessage, durationMs);
      }
    } catch (e) {
      logToFile(`${AgentSignals.BENCHMARK} Middleware finalize error:`, e);
    }

    const mwGet = <T>(key: string): T | undefined =>
      middleware?.get ? middleware.get<T>(key) : undefined;
    const tokens = mwGet<{ totalInput: number; totalOutput: number }>('tokens');
    const cache = mwGet<{
      totalRead: number;
      totalCreation5m: number;
      totalCreation1h: number;
      totalCreation: number;
    }>('cache');
    const cost = mwGet<{ totalCost: number }>('cost');
    const turns = mwGet<{ totalTurns: number }>('turns');

    const inputTokens = tokens?.totalInput ?? 0;
    const outputTokens = tokens?.totalOutput ?? 0;
    const cacheRead = cache?.totalRead ?? 0;
    const cacheCreation =
      cache?.totalCreation ??
      (cache?.totalCreation5m ?? 0) + (cache?.totalCreation1h ?? 0);
    // Cache hit rate: read / (read + creation). Undefined when there's no cache usage at all.
    const cacheTotal = cacheRead + cacheCreation;
    const cacheHitRate = cacheTotal > 0 ? cacheRead / cacheTotal : null;

    analytics.wizardCapture('agent completed', {
      'duration ms': durationMs,
      'duration seconds': durationSeconds,
      'input tokens': inputTokens,
      'output tokens': outputTokens,
      'cache read input tokens': cacheRead,
      'cache creation 5m tokens': cache?.totalCreation5m ?? 0,
      'cache creation 1h tokens': cache?.totalCreation1h ?? 0,
      'total cost usd': cost?.totalCost ?? 0,
      'cache hit rate': cacheHitRate,
      turns: turns?.totalTurns ?? 0,
      model: agentConfig.model ?? null,
      'fallback used': Boolean(agentConfig.useLocalClaude),
      // Phase attribution — today every run is one monolithic loop. Bet 2's
      // three-phase pipeline (Planner → Integrator → Instrumenter) will
      // split this into per-phase `agent completed` events. Keeping the
      // property now future-proofs the event schema.
      phase: 'monolithic',
    });

    // Kill-criterion monitoring for Bet 2 Slice 1 (prompt caching): if the
    // prefix has been warm long enough to be cached (input tokens above
    // WARM_RUN_TOKEN_FLOOR) but the hit rate is below CACHE_MISS_THRESHOLD,
    // emit a separate anomaly event so Amplitude can alert + Sentry can
    // surface the pattern. Skipped on cold runs (first invocation or small
    // prompts) where the cache can't possibly have warmed up.
    const WARM_RUN_TOKEN_FLOOR = 5000;
    const CACHE_MISS_THRESHOLD = 0.4;
    if (
      cacheHitRate !== null &&
      inputTokens >= WARM_RUN_TOKEN_FLOOR &&
      cacheHitRate < CACHE_MISS_THRESHOLD
    ) {
      analytics.wizardCapture('cache miss anomaly', {
        'cache hit rate': cacheHitRate,
        'input tokens': inputTokens,
        'cache read input tokens': cacheRead,
        'cache creation tokens': cacheCreation,
        threshold: CACHE_MISS_THRESHOLD,
        'warm run token floor': WARM_RUN_TOKEN_FLOOR,
        model: agentConfig.model ?? null,
      });
    }
    spinner.stop(successMessage);
    return {};
  };

  // Heartbeat interval — every 10s print the last 3 STATUS messages so the
  // user can see progress in the CLI without waiting for the next update.
  const heartbeatInterval = setInterval(() => {
    if (recentStatuses.length > 0) {
      getUI().heartbeat([...recentStatuses]);
    }
  }, 10_000);

  // Event plan file watcher — cleaned up in finally block
  let eventPlanWatcher: fs.FSWatcher | undefined;
  let eventPlanInterval: ReturnType<typeof setInterval> | undefined;

  // Dashboard file watcher — cleaned up in finally block
  let dashboardWatcher: fs.FSWatcher | undefined;
  let dashboardInterval: ReturnType<typeof setInterval> | undefined;

  try {
    // Tools needed for the wizard:
    // - File operations: Read, Write, Edit
    // - Search: Glob, Grep
    // - Commands: Bash (with restrictions via canUseTool)
    // - MCP discovery: ListMcpResourcesTool (to find available skills)
    // - Skills: Skill (to load installed Amplitude skills)
    // MCP tools (Amplitude) come from mcpServers, not allowedTools
    const allowedTools = [
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'Bash',
      'ListMcpResourcesTool',
      'Skill',
      ...WIZARD_TOOL_NAMES,
    ];

    // Watch for .amplitude-events.json and feed into the store (set up once, before retries)
    const eventPlanPath = path.join(
      agentConfig.workingDirectory,
      '.amplitude-events.json',
    );
    const eventPlanSchema = z.array(
      z.looseObject({
        name: z.string().optional(),
        event: z.string().optional(),
        eventName: z.string().optional(),
        description: z.string().optional(),
        eventDescriptionAndReasoning: z.string().optional(),
      }),
    );
    const readEventPlan = () => {
      try {
        const content = fs.readFileSync(eventPlanPath, 'utf-8');
        const result = eventPlanSchema.safeParse(JSON.parse(content));
        if (result.success) {
          getUI().setEventPlan(
            result.data.map((e) => ({
              name: e.name ?? e.event ?? e.eventName ?? '',
              description:
                e.description ?? e.eventDescriptionAndReasoning ?? '',
            })),
          );
        }
      } catch {
        // File doesn't exist or isn't valid JSON yet
      }
    };

    try {
      eventPlanWatcher = fs.watch(eventPlanPath, () => readEventPlan());
      readEventPlan();
    } catch {
      // File doesn't exist yet — poll until it appears
      eventPlanInterval = setInterval(() => {
        try {
          fs.accessSync(eventPlanPath);
          readEventPlan();
          clearInterval(eventPlanInterval);
          eventPlanInterval = undefined;
          eventPlanWatcher = fs.watch(eventPlanPath, () => readEventPlan());
        } catch {
          // Still waiting
        }
      }, 1000);
    }

    // Watch for .amplitude-dashboard.json written by the agent after dashboard creation.
    // Parses the dashboard URL and forwards it to the UI so ChecklistScreen can
    // surface a direct link without requiring any further user action.
    // workingDirectory is the CLI install dir (process.cwd() or --install-dir),
    // not untrusted network input. The filename is a hardcoded constant.
    const dashboardFilePath = path.join(
      agentConfig.workingDirectory,
      '.amplitude-dashboard.json',
    ); // nosemgrep
    const dashboardFileSchema = z.object({
      dashboardUrl: z.string().url(),
    });
    const readDashboardFile = () => {
      try {
        const content = fs.readFileSync(dashboardFilePath, 'utf-8');
        const result = dashboardFileSchema.safeParse(JSON.parse(content));
        if (result.success) {
          getUI().setDashboardUrl(result.data.dashboardUrl);
        }
      } catch {
        // File doesn't exist or isn't valid JSON yet
      }
    };

    try {
      dashboardWatcher = fs.watch(dashboardFilePath, () => readDashboardFile());
      readDashboardFile();
    } catch {
      // File doesn't exist yet — poll until it appears
      dashboardInterval = setInterval(() => {
        try {
          fs.accessSync(dashboardFilePath);
          readDashboardFile();
          clearInterval(dashboardInterval);
          dashboardInterval = undefined;
          dashboardWatcher = fs.watch(dashboardFilePath, () =>
            readDashboardFile(),
          );
        } catch {
          // Still waiting
        }
      }, 1000);
    }

    // Retry loop: if the agent stalls (no message for the configured timeout), abort
    // and re-run with a fresh AbortController and prompt stream. Up to MAX_RETRIES.
    const MAX_RETRIES = 3;
    // Cold-start timeout: subprocess spawn + MCP server connections + first LLM response
    const INITIAL_STALL_TIMEOUT_MS = 60_000;
    // Mid-run timeout: between consecutive messages during active work.
    // Raised from 30s to 120s to accommodate extended thinking (Opus can
    // think for 10+ min before emitting the first token with the proxy's
    // 20-min fetch timeout).
    const STALL_TIMEOUT_MS = 120_000;

    // Tracks whether an authentication failure was detected in the current attempt.
    // Passed to createStopHook so it can skip reflection when auth is broken.
    let authErrorDetected = false;

    // Per-attempt recovery bag: modified files + last status. PreCompact
    // persists a snapshot to disk so context dropped by compaction stays
    // recoverable by a post-compaction hydration hook.
    const agentState = new AgentState();

    // Structured status state populated by the `report_status` MCP tool.
    // Replaces the legacy [STATUS] / [ERROR-*] text-marker regex scanner.
    let reportedError: StatusReport | null = null;
    _activeStatusReporter = {
      onStatus(report) {
        spinner.message(report.detail);
        recentStatuses.push(report.detail);
        if (recentStatuses.length > 3) recentStatuses.shift();
        agentState.recordStatus(report.code, report.detail);
      },
      onError(report) {
        // First error wins — stall/retry loop reads this after the attempt.
        if (!reportedError) reportedError = report;
        logToFile(
          `Structured error reported: ${report.code} — ${report.detail}`,
        );
      },
    };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      agentState.setAttemptId(`attempt-${attempt}`);
      if (attempt > 0) {
        // Exponential backoff: 2s, 4s, 8s
        const backoffMs = Math.min(2_000 * Math.pow(2, attempt - 1), 8_000);
        logToFile(
          `Agent stall retry: attempt ${attempt + 1} of ${
            MAX_RETRIES + 1
          }, backing off ${backoffMs}ms`,
        );
        analytics.wizardCapture('agent stall retry', {
          attempt,
          'backoff ms': backoffMs,
        });
        getUI().pushStatus(
          `Retrying connection (attempt ${attempt + 1} of ${
            MAX_RETRIES + 1
          })...`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        // Clear per-attempt output so stale error markers don't affect the fresh run
        collectedText.length = 0;
        recentStatuses.length = 0;
        authErrorDetected = false;
        reportedError = null;
      }

      // Fresh prompt stream per attempt — stdin stays open until result received
      const resultReceived = new Promise<void>((resolve) => {
        signalDone = resolve;
      });

      const createPromptStream = async function* () {
        yield {
          type: 'user',
          session_id: '',
          message: { role: 'user', content: prompt },
          parent_tool_use_id: null,
        };
        await resultReceived;
      };

      // AbortController lets us cancel a stalled query so we can retry
      const controller = new AbortController();
      let staleTimer: ReturnType<typeof setTimeout> | undefined;
      let receivedFirstMessage = false;
      let lastMessageType = 'none';
      let lastMessageTime = Date.now();

      const resetStaleTimer = () => {
        if (staleTimer) clearTimeout(staleTimer);
        const timeoutMs = receivedFirstMessage
          ? STALL_TIMEOUT_MS
          : INITIAL_STALL_TIMEOUT_MS;
        staleTimer = setTimeout(() => {
          const elapsed = Math.round((Date.now() - lastMessageTime) / 1000);
          logToFile(
            `Agent stalled — no message for ${elapsed}s (attempt ${
              attempt + 1
            }, last message: ${lastMessageType}, phase: ${
              receivedFirstMessage ? 'active' : 'cold-start'
            })`,
          );
          analytics.wizardCapture('agent stall detected', {
            attempt: attempt + 1,
            'stall timeout ms': timeoutMs,
            'last message type': lastMessageType,
            phase: receivedFirstMessage ? 'active' : 'cold-start',
          });
          controller.abort('stall');
        }, timeoutMs);
      };

      try {
        const response = query({
          prompt: createPromptStream(),
          options: {
            model: agentConfig.model,
            // Fallback model if primary is unavailable (e.g. Vertex outage).
            // Must be capable enough for code generation — haiku is too weak.
            fallbackModel: agentConfig.useDirectApiKey
              ? 'claude-sonnet-4-5-20250514'
              : 'anthropic/claude-sonnet-4-5-20250514',
            cwd: agentConfig.workingDirectory,
            permissionMode: 'acceptEdits',
            mcpServers: agentConfig.mcpServers,
            // Safety nets: cap runaway tool loops and token spend
            maxTurns: 200,
            // Load skills from project's .claude/skills/ directory
            settingSources: ['project'],
            // Explicitly enable required tools including Skill
            allowedTools,
            systemPrompt: {
              type: 'preset',
              preset: 'claude_code',
              // Append wizard-wide commandments (from YAML) rather than replacing
              // the preset so we keep default Claude Code behaviors.
              append: getWizardCommandments(),
              // Strip per-run / per-machine sections (date, cwd) from the
              // preset so the static prefix is identical across runs. This
              // is the supported SDK path for prompt caching — the SDK
              // attaches cache_control internally when the prefix is stable.
              // Per-run values (projectApiKey, projectId, framework version)
              // already live in the first user message built by
              // buildIntegrationPrompt, not in this system prefix.
              // Set AMPLITUDE_WIZARD_DISABLE_CACHE=1 to disable — kill
              // switch for the Slice 1 kill criterion (<40% hit rate).
              excludeDynamicSections:
                process.env.AMPLITUDE_WIZARD_DISABLE_CACHE !== '1',
            },
            env: {
              ...process.env,
              // When using the Amplitude gateway, block ANTHROPIC_API_KEY so it doesn't
              // override the gateway's OAuth token. When using a direct API key, pass it through.
              ...(agentConfig.useDirectApiKey
                ? {}
                : { ANTHROPIC_API_KEY: undefined }),
              ANTHROPIC_CUSTOM_HEADERS: buildAgentEnv(
                agentConfig.wizardMetadata ?? {},
                agentConfig.wizardFlags ?? {},
              ),
            },
            canUseTool: (toolName: string, input: unknown) => {
              logToFile('canUseTool called:', { toolName, input });
              const result = wizardCanUseTool(
                toolName,
                input as Record<string, unknown>,
              );
              logToFile('canUseTool result:', result);
              return Promise.resolve(result);
            },
            tools: { type: 'preset', preset: 'claude_code' },
            // Capture stderr from CLI subprocess for debugging
            stderr: (data: string) => {
              logToFile('CLI stderr:', data);
              if (options.debug) {
                debug('CLI stderr:', data);
              }
            },
            hooks: buildHooksConfig({
              Stop: createStopHook(
                config?.additionalFeatureQueue ?? [],
                () => authErrorDetected,
              ),
              UserPromptSubmit: createUserPromptSubmitHook(agentState),
            }),
            // Allow aborting a stalled query so we can retry cleanly
            abortSignal: controller.signal,
          },
        });

        // Start stale timer — reset on each received message
        resetStaleTimer();

        // Process the async generator — validate each message at the boundary
        for await (const rawMessage of response) {
          receivedFirstMessage = true;
          lastMessageTime = Date.now();
          lastMessageType =
            (rawMessage as Record<string, unknown>)?.type?.toString() ??
            'unknown';
          resetStaleTimer();
          const parsed = safeParseSDKMessage(rawMessage);
          if (!parsed.ok) {
            logToFile(
              'Skipping malformed SDK message:',
              parsed.error.issues.map(
                (i) => `${i.path.join('.')}: ${i.message}`,
              ),
            );
            continue;
          }
          const message = parsed.message;

          // Pass receivedSuccessResult so handleSDKMessage can suppress user-facing error
          // output for post-success cleanup errors while still logging them to file
          handleSDKMessage(
            message,
            options,
            spinner,
            collectedText,
            receivedSuccessResult,
            recentStatuses,
          );

          try {
            middleware?.onMessage(message);
          } catch (e) {
            logToFile(
              `${AgentSignals.BENCHMARK} Middleware onMessage error:`,
              e,
            );
          }

          // Detect authentication failures so the stop hook can skip reflection
          if (
            message.type === 'result' &&
            message.is_error &&
            JSON.stringify(message).includes('authentication_failed')
          ) {
            authErrorDetected = true;
            logToFile('Auth error detected: authentication_failed in result');
          }

          if (message.type === 'system' && message.subtype === 'init') {
            for (const server of (
              message as unknown as {
                mcp_servers?: { name: string; status: string }[];
              }
            ).mcp_servers ?? []) {
              if (
                server.name === 'amplitude-wizard' &&
                server.status === 'needs-auth'
              ) {
                authErrorDetected = true;
                logToFile(
                  'Auth error detected: amplitude-wizard MCP needs-auth',
                );
              }
            }
          }

          // Signal completion when result received
          if (message.type === 'result') {
            // Track successful results before any potential cleanup errors
            // The SDK may emit a second error result during cleanup due to a race condition
            if (message.subtype === 'success' && !message.is_error) {
              receivedSuccessResult = true;
              lastResultMessage = message;
            }
            signalDone();
          }
        }

        // Check if the agent hit a transient API error (e.g. Vertex 400)
        // that warrants a retry rather than immediately giving up.
        clearTimeout(staleTimer);
        const partialOutput = collectedText.join('\n');
        const transientErrorMatchers = [
          { pattern: 'API Error: 400', label: 'api_400' },
          { pattern: 'API Error: 408', label: 'api_408' },
          { pattern: 'API Error: 503', label: 'api_503' },
          { pattern: 'API Error: 529', label: 'api_529' },
          { pattern: 'DEADLINE_EXCEEDED', label: 'deadline_exceeded' },
        ];
        const matchedTransientError = transientErrorMatchers.find((m) =>
          partialOutput.includes(m.pattern),
        );
        const hitTransientApiError =
          !receivedSuccessResult &&
          !authErrorDetected &&
          attempt < MAX_RETRIES &&
          !!matchedTransientError;

        if (hitTransientApiError && matchedTransientError) {
          logToFile(
            `Retrying after ${matchedTransientError.pattern} (next attempt: ${
              attempt + 2
            } of ${MAX_RETRIES + 1})`,
          );
          analytics.wizardCapture('agent api error retry', {
            attempt,
            error: matchedTransientError.label,
          });
          collectedText.length = 0;
          recentStatuses.length = 0;
          signalDone();
          continue;
        }

        // Clean completion — exit the retry loop
        break;
      } catch (innerError) {
        clearTimeout(staleTimer);
        signalDone(); // unblock the prompt stream for this attempt

        // Stall-aborted or API error with retries remaining — try again
        if (controller.signal.aborted && attempt < MAX_RETRIES) {
          logToFile(
            `Retrying after stall (next attempt: ${attempt + 2} of ${
              MAX_RETRIES + 1
            })`,
          );
          continue;
        }

        // Transient SDK/proxy error: malformed conversation history (tool_use
        // without tool_result), API errors, or Vertex-specific transient failures.
        // These resolve on a fresh retry with a new conversation.
        const errMsg =
          innerError instanceof Error ? innerError.message : String(innerError);
        const isTransientSdkError =
          attempt < MAX_RETRIES &&
          !authErrorDetected &&
          (errMsg.includes('tool_use') ||
            errMsg.includes('tool_result') ||
            errMsg.includes('API Error: 400') ||
            errMsg.includes('API Error: 408') ||
            errMsg.includes('API Error: 503') ||
            errMsg.includes('API Error: 529') ||
            errMsg.includes('DEADLINE_EXCEEDED') ||
            errMsg.includes('invalid_request_error'));
        if (isTransientSdkError) {
          logToFile(
            `Retrying after transient SDK error (next attempt: ${
              attempt + 2
            } of ${MAX_RETRIES + 1}): ${errMsg.slice(0, 200)}`,
          );
          analytics.wizardCapture('agent sdk error retry', {
            attempt,
            error: errMsg.slice(0, 200),
          });
          collectedText.length = 0;
          recentStatuses.length = 0;
          continue;
        }

        // Already received a successful result — this is an SDK cleanup race condition
        if (receivedSuccessResult) {
          return completeWithSuccess(innerError as Error);
        }

        // Re-throw to the outer catch for API error handling / spinner cleanup
        throw innerError;
      }
    }

    const outputText = collectedText.join('\n');

    // Auth error takes priority — the agent cannot recover without re-authentication
    if (authErrorDetected) {
      logToFile('Agent error: AUTH_ERROR');
      spinner.stop('Authentication failed');
      _activeStatusReporter = undefined;
      return { error: AgentErrorType.AUTH_ERROR };
    }

    // Structured error signals via `report_status` (replaces text-marker regex).
    if (reportedError) {
      const { code, detail } = reportedError;
      if (code === 'MCP_MISSING') {
        logToFile('Agent error: MCP_MISSING');
        spinner.stop(detail || 'Agent could not access Amplitude MCP');
        _activeStatusReporter = undefined;
        return { error: AgentErrorType.MCP_MISSING, message: detail };
      }
      if (code === 'RESOURCE_MISSING') {
        logToFile('Agent error: RESOURCE_MISSING');
        spinner.stop(detail || 'Agent could not access setup resource');
        _activeStatusReporter = undefined;
        return { error: AgentErrorType.RESOURCE_MISSING, message: detail };
      }
      // Unknown structured error code — log it, let the regex-driven API-error
      // path below still run (API errors aren't reported via report_status).
      logToFile(`Unhandled structured error code: ${code}`);
    }

    // Check for API errors (rate limits, etc.)
    // Extract just the API error line(s), not the entire output
    const apiErrorMatch = outputText.match(/API Error: [^\n]+/g);
    const apiErrorMessage = apiErrorMatch
      ? apiErrorMatch.join('\n')
      : 'Unknown API error';

    if (outputText.includes('API Error: 429')) {
      logToFile('Agent error: RATE_LIMIT');
      spinner.stop('Rate limit exceeded');
      return { error: AgentErrorType.RATE_LIMIT, message: apiErrorMessage };
    }

    if (outputText.includes('API Error:')) {
      logToFile('Agent error: API_ERROR');
      spinner.stop('API error occurred');
      return { error: AgentErrorType.API_ERROR, message: apiErrorMessage };
    }

    return completeWithSuccess();
  } catch (error) {
    // Signal done to unblock the async generator
    signalDone();

    // If we already received a successful result, the error is from SDK cleanup
    // This happens due to a race condition: the SDK tries to send a cleanup command
    // after the prompt stream closes, but streaming mode is still active.
    // See: https://github.com/anthropics/claude-agent-sdk-typescript/issues/41
    if (receivedSuccessResult) {
      return completeWithSuccess(error as Error);
    }

    // Check if we collected an API error before the exception was thrown
    const outputText = collectedText.join('\n');

    // Extract just the API error line(s), not the entire output
    const apiErrorMatch = outputText.match(/API Error: [^\n]+/g);
    const apiErrorMessage = apiErrorMatch
      ? apiErrorMatch.join('\n')
      : 'Unknown API error';

    if (outputText.includes('API Error: 429')) {
      logToFile('Agent error (caught): RATE_LIMIT');
      spinner.stop('Rate limit exceeded');
      return { error: AgentErrorType.RATE_LIMIT, message: apiErrorMessage };
    }

    if (outputText.includes('API Error:')) {
      logToFile('Agent error (caught): API_ERROR');
      spinner.stop('API error occurred');
      return { error: AgentErrorType.API_ERROR, message: apiErrorMessage };
    }

    // No API error found, re-throw the original exception
    spinner.stop(errorMessage);
    getUI().log.error(`Error: ${(error as Error).message}`);
    logToFile('Agent run failed:', error);
    debug('Full error:', error);
    throw error;
  } finally {
    clearInterval(heartbeatInterval);
    eventPlanWatcher?.close();
    if (eventPlanInterval) clearInterval(eventPlanInterval);
    dashboardWatcher?.close();
    if (dashboardInterval) clearInterval(dashboardInterval);
    _activeStatusReporter = undefined;
  }
}

/**
 * Handle SDK messages and provide user feedback
 *
 * @param receivedSuccessResult - If true, suppress user-facing error output for cleanup errors
 *                          while still logging to file. The SDK may emit a second error
 *                          result after success due to cleanup race conditions.
 */
function handleSDKMessage(
  message: SDKMessage,
  options: WizardOptions,
  spinner: SpinnerHandle,
  collectedText: string[],
  receivedSuccessResult = false,
  _recentStatuses?: string[],
): void {
  logToFile(`SDK Message: ${message.type}`, JSON.stringify(message, null, 2));

  if (options.debug) {
    debug(`SDK Message type: ${message.type}`);
  }

  switch (message.type) {
    case 'assistant': {
      // Extract text content from assistant messages
      const content = message.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            collectedText.push(block.text);
            // Status updates now flow through the `report_status` MCP tool,
            // wired to the spinner via StatusReporter in runAgent. No more
            // [STATUS] text-marker scanning — see wizard-tools.ts.
          }

          // Intercept TodoWrite tool_use blocks for task progression
          if (
            block.type === 'tool_use' &&
            block.name === 'TodoWrite' &&
            block.input &&
            Array.isArray(block.input.todos)
          ) {
            getUI().syncTodos(
              block.input.todos as Array<{
                content: string;
                status: string;
                activeForm?: string;
              }>,
            );
          }
        }
      }
      break;
    }

    case 'result': {
      // Check is_error flag - can be true even when subtype is 'success'
      if (message.is_error) {
        logToFile('Agent result with error:', message.result);
        if (typeof message.result === 'string') {
          collectedText.push(message.result);
        }
        // Only show errors to user if we haven't already succeeded.
        // Post-success errors are SDK cleanup noise (telemetry failures, streaming
        // mode race conditions). Full message already logged above via JSON dump.
        if (message.errors && !receivedSuccessResult) {
          for (const err of message.errors) {
            getUI().log.error(`Error: ${err}`);
            logToFile('ERROR:', err);
          }
        }
      } else if (message.subtype === 'success') {
        logToFile('Agent completed successfully');
        if (typeof message.result === 'string') {
          collectedText.push(message.result);
        }
      } else {
        logToFile('Agent result with error:', message.result);
        // Error result - only show to user if we haven't already succeeded.
        // Full message already logged above via JSON dump.
        if (message.errors && !receivedSuccessResult) {
          for (const err of message.errors) {
            getUI().log.error(`Error: ${err}`);
            logToFile('ERROR:', err);
          }
        }
      }
      break;
    }

    case 'system': {
      if (message.subtype === 'init') {
        const mcpStatuses = message.mcp_servers ?? [];
        logToFile('Agent session initialized', {
          model: message.model,
          tools: message.tools?.length,
          mcpServers: mcpStatuses,
        });

        for (const server of mcpStatuses) {
          logToFile(`MCP "${server.name}": ${server.status}`);
          if (server.status !== 'connected') {
            getUI().log.warn(
              `MCP server "${server.name}" is not connected (${server.status})`,
            );
          }
        }
      }
      break;
    }

    default:
      // Log other message types for debugging
      if (options.debug) {
        debug(`Unhandled message type: ${message.type}`);
      }
      break;
  }
}
