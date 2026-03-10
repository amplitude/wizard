import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { type Mock } from 'vitest';

// Mock functions must be defined before imports
const mockRunWizard = vi.fn();
const mockDetectIntegration = vi.fn().mockResolvedValue(undefined);

vi.mock('../run', () => ({
  runWizard: mockRunWizard,
  detectIntegration: mockDetectIntegration,
}));
vi.mock('semver', () => ({ satisfies: () => true }));
vi.mock('../ui/tui/start-tui', () => ({
  startTUI: () => ({
    unmount: vi.fn(),
    waitForSetup: vi.fn().mockResolvedValue(undefined),
    store: {
      session: {},
      setFrameworkConfig: vi.fn(),
      setDetectedFramework: vi.fn(),
      setDetectionComplete: vi.fn(),
      setFrameworkContext: vi.fn(),
      addDiscoveredFeature: vi.fn(),
    },
  }),
}));
vi.mock('../lib/wizard-session', () => ({
  buildSession: (args: Record<string, unknown>) => args,
  DiscoveredFeature: {},
}));
vi.mock('../lib/registry', () => ({ FRAMEWORK_REGISTRY: {} }));
vi.mock('../lib/constants', () => ({
  DETECTION_TIMEOUT_MS: 100,
  IS_DEV: true,
}));

describe.skip('CLI argument parsing', () => {
  const originalArgv = process.argv;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalExit = process.exit;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset environment
    process.env = { ...originalEnv };
    delete process.env.AMPLITUDE_WIZARD_DEFAULT;
    delete process.env.AMPLITUDE_WIZARD_CI;
    delete process.env.AMPLITUDE_WIZARD_API_KEY;
    delete process.env.AMPLITUDE_WIZARD_INSTALL_DIR;

    // Mock process.exit to prevent test runner from exiting
    process.exit = vi.fn() as any;
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
    process.env = originalEnv;
    vi.resetModules();
  });

  /**
   * Helper to run the CLI with given arguments
   */
  async function runCLI(args: string[]) {
    process.argv = ['node', 'bin.ts', ...args];

    vi.resetModules();
    await import('../../bin.ts');

    // Allow yargs to process
    await new Promise((resolve) => setImmediate(resolve));
  }

  /**
   * Helper to get the arguments passed to a mock function
   */
  function getLastCallArgs(mockFn: Mock) {
    expect(mockFn).toHaveBeenCalled();
    return mockFn.mock.calls[mockFn.mock.calls.length - 1][0];
  }

  describe('--default flag', () => {
    test.skip('defaults to true when not specified', async () => {
      await runCLI([]);

      const args = getLastCallArgs(mockRunWizard);
      expect(args.default).toBe(true);
    });

    test.skip('can be explicitly set to false with --no-default', async () => {
      await runCLI(['--no-default']);

      const args = getLastCallArgs(mockRunWizard);
      expect(args.default).toBe(false);
    });

    test.skip('can be explicitly set to true', async () => {
      await runCLI(['--default']);

      const args = getLastCallArgs(mockRunWizard);
      expect(args.default).toBe(true);
    });
  });

  describe('environment variables', () => {
    test.skip('respects AMPLITUDE_WIZARD_DEFAULT', async () => {
      process.env.AMPLITUDE_WIZARD_DEFAULT = 'false';

      await runCLI([]);

      const args = getLastCallArgs(mockRunWizard);
      expect(args.default).toBe(false);
    });

    test('CLI args override environment variables', async () => {
      process.env.AMPLITUDE_WIZARD_DEFAULT = 'false';

      await runCLI(['--default']);

      const args = getLastCallArgs(mockRunWizard);
      expect(args.default).toBe(true);
    });
  });

  describe('backward compatibility', () => {
    test('all existing flags continue to work', async () => {
      await runCLI([
        '--debug',
        '--signup',
        '--force-install',
        '--install-dir',
        '/custom/path',
        '--integration',
        'nextjs',
      ]);

      const args = getLastCallArgs(mockRunWizard);

      // Existing flags
      expect(args.debug).toBe(true);
      expect(args.signup).toBe(true);
      expect(args['force-install']).toBe(true);
      expect(args['install-dir']).toBe('/custom/path');
      expect(args.integration).toBe('nextjs');

      // New defaults
      expect(args.default).toBe(true);
    });
  });

  // MCP commands now launch TUI — tested via integration tests

  describe('--ci flag', () => {
    test('defaults to false when not specified', async () => {
      await runCLI([]);

      const args = getLastCallArgs(mockRunWizard);
      expect(args.ci).toBe(false);
    });

    test('can be set to true', async () => {
      await runCLI([
        '--ci',
        '--api-key',
        'phx_test',
        '--install-dir',
        '/tmp/test',
      ]);

      const args = getLastCallArgs(mockRunWizard);
      expect(args.ci).toBe(true);
    });

    test('requires --api-key when --ci is set', async () => {
      await runCLI(['--ci', '--install-dir', '/tmp/test']);

      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('requires --install-dir when --ci is set', async () => {
      await runCLI(['--ci', '--api-key', 'phx_test']);

      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('passes --api-key to runWizard', async () => {
      await runCLI([
        '--ci',
        '--api-key',
        'phx_test_key',
        '--install-dir',
        '/tmp/test',
      ]);

      const args = getLastCallArgs(mockRunWizard);
      expect(args.apiKey).toBe('phx_test_key');
    });
  });

  describe('CI environment variables', () => {
    test.skip('respects AMPLITUDE_WIZARD_CI', async () => {
      process.env.AMPLITUDE_WIZARD_CI = 'true';
      process.env.AMPLITUDE_WIZARD_API_KEY = 'phx_env_key';
      process.env.AMPLITUDE_WIZARD_INSTALL_DIR = '/tmp/test';

      await runCLI([]);

      const args = getLastCallArgs(mockRunWizard);
      expect(args.ci).toBe(true);
    });

    test.skip('respects AMPLITUDE_WIZARD_API_KEY', async () => {
      process.env.AMPLITUDE_WIZARD_CI = 'true';
      process.env.AMPLITUDE_WIZARD_API_KEY = 'phx_env_key';
      process.env.AMPLITUDE_WIZARD_INSTALL_DIR = '/tmp/test';

      await runCLI([]);

      const args = getLastCallArgs(mockRunWizard);
      expect(args.apiKey).toBe('phx_env_key');
    });

    test('CLI args override CI environment variables', async () => {
      process.env.AMPLITUDE_WIZARD_CI = 'true';
      process.env.AMPLITUDE_WIZARD_API_KEY = 'phx_env_key';
      process.env.AMPLITUDE_WIZARD_INSTALL_DIR = '/tmp/test';

      await runCLI([
        '--api-key',
        'phx_cli_key',
        '--install-dir',
        '/other/path',
      ]);

      const args = getLastCallArgs(mockRunWizard);
      expect(args.apiKey).toBe('phx_cli_key');
    });
  });
});
