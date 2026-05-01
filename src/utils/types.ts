/**
 * Internal agent model tier. The default (`'standard'`) is the wizard's
 * production model and the only tier that should appear in user-facing
 * documentation. See `docs/internal/agent-mode-flag.md` for the model
 * mapping and the reason this enum is intentionally not advertised.
 */
export type WizardMode = 'fast' | 'standard' | 'thorough';

export const WIZARD_MODES: readonly WizardMode[] = [
  'fast',
  'standard',
  'thorough',
] as const;

export type AmplitudeProjectData = Record<string, unknown>;

export type PreselectedProject = {
  project: AmplitudeProjectData;
  authToken: string;
};

export type WizardOptions = {
  /**
   * Whether to enable debug mode.
   */
  debug: boolean;

  /**
   * Whether to force install the SDK package to continue with the installation in case
   * any package manager checks are failing (e.g. peer dependency versions).
   *
   * Use with caution and only if you know what you're doing.
   *
   * Does not apply to all wizard flows (currently NPM only)
   */
  forceInstall: boolean;

  /**
   * The directory to run the wizard in.
   */
  installDir: string;

  /**
   * Whether to select the default option for all questions automatically.
   */
  default: boolean;

  /**
   * Whether the run is on the path to create a new Amplitude account (`--signup`).
   */
  accountCreationFlow: boolean;

  /**
   * Whether to use the local MCP server at http://localhost:8787/mcp
   */
  localMcp: boolean;

  /**
   * CI mode - non-interactive execution
   */
  ci: boolean;

  /**
   * Personal API key (phx_xxx) - used for LLM gateway auth, skips OAuth
   */
  apiKey?: string;

  /**
   * Numeric Amplitude app ID (canonical: `app_id` in Python, `appId` in TS).
   * When set (e.g. with `--app-id`, or the `--project-id` legacy alias), the
   * wizard uses this app instead of the default from the API key or OAuth.
   */
  appId?: number;

  /**
   * Whether to show the menu for manual integration selection instead of auto-detecting.
   */
  menu: boolean;

  /**
   * Whether to run in benchmark mode with per-phase token tracking.
   * When enabled, the wizard runs each workflow phase as a separate agent call
   * and writes detailed usage data to amplitude-wizard-benchmark.json in the OS temp dir.
   */
  benchmark: boolean;

  /**
   * Internal model tier — see `docs/internal/agent-mode-flag.md`.
   * Optional; omitted call sites inherit the schema default.
   */
  mode?: WizardMode;
};

export interface Feature {
  id: string;
  prompt: string;
  enabledHint?: string;
  disabledHint?: string;
}

export type FileChange = {
  filePath: string;
  oldContent?: string;
  newContent: string;
};

export type CloudRegion = 'us' | 'eu';

export type AIModel =
  | 'gpt-5-mini'
  | 'o4-mini'
  | 'gemini-2.5-flash'
  | 'gemini-2.5-pro';
