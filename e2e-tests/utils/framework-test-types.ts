import type { WizardTestEnv } from './index';
import type { NDJSONEvent } from '../../src/ui/agent-ui';

export interface WizardStep {
  name: string;
  waitFor: string;
  response?: string[] | string;
  responseWaitFor?: string;
  timeout?: number;
  optional?: boolean;
  condition?: (instance: WizardTestEnv) => boolean;
}

export interface AgentAssertions {
  /**
   * If set, assert that a `setDetectedFramework` session_state event was
   * emitted with this label. Useful as a cheap detection smoke test.
   */
  expectedFrameworkLabel?: string;
  /**
   * Additional predicates that must each match at least one emitted event.
   * Each predicate receives the raw NDJSONEvent stream.
   */
  expectedEvents?: Array<(event: NDJSONEvent) => boolean>;
}

export interface FrameworkTestConfig {
  /** Framework name for the test suite */
  name: string;
  /** Relative path to the test application directory */
  projectDir: string;
  /**
   * If set, resolve the app from `$E2E_WORKBENCH_DIR/apps/<workbenchApp>`
   * instead of from the in-repo `e2e-tests/test-applications/<projectDir>`.
   * Example: `'python/django'`.
   *
   * When this is set but `E2E_WORKBENCH_DIR` is not defined, the test
   * suite will be skipped with a helpful message.
   */
  workbenchApp?: string;
  /**
   * When true, run the wizard with `--agent` (NDJSON mode) instead of driving
   * the interactive TUI. The `DEFAULT_WIZARD_STEPS` flow is bypassed; instead
   * the setup waits for NDJSON lifecycle events (`intro`, `start_run`,
   * `outro` or `error`) and can run `agentAssertions` against the stream.
   */
  agentMode?: boolean;
  /**
   * Assertions that run after the agent stream terminates. Only consulted
   * when `agentMode: true`.
   */
  agentAssertions?: AgentAssertions;
  /**
   * Optional framework key used to scope fixtures on disk under
   * `e2e-tests/fixtures/<framework>/<hash>.json`. When omitted, fixtures
   * use the legacy flat layout.
   */
  fixtureFramework?: string;
  /** Expected output strings for different modes while running the tests */
  expectedOutput: {
    dev: string;
    prod?: string;
  };
  /** Custom wizard flow steps (overrides default flow) */
  customWizardSteps?: WizardStep[];
  /** Additional wizard steps to insert at specific positions */
  additionalSteps?: {
    before?: string; // Insert before this step name
    after?: string; // Insert after this step name
    steps: WizardStep[];
  }[];
  hooks?: {
    beforeWizard?: () => Promise<void> | void; // Hook to run before the wizard starts
    afterWizard?: () => Promise<void> | void; // Hook to run after the wizard finishes
    beforeTests?: () => Promise<void> | void; // Hook to run before the tests start
    afterTests?: () => Promise<void> | void; // Hook to run after the tests finish
  };
  /** Standard tests to run */
  tests?: {
    packageJson?: string[]; // Package names to check
    devMode?: boolean; // Whether to test the dev mode
    build?: boolean; // Whether to test if the build command works
    prodMode?: boolean | string; // true for 'start' as prod mode, string for custom command
  };
  /** Custom test definitions */
  customTests?: Array<{
    name: string;
    fn: (projectDir: string) => Promise<void> | void;
  }>;
}
