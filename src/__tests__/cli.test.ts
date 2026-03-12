import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { type Mock } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ── Hoisted mock state ─────────────────────────────────────────────────────────
// vi.hoisted() ensures these are available inside vi.mock() factory functions.

const {
  mockStore,
  mockPerformAmplitudeAuth,
  mockFetchAmplitudeUser,
  mockStoreToken,
  mockGetStoredUser,
  mockGetStoredToken,
  mockAmpliConfigExists,
  mockIsNonInteractiveEnvironment,
  mockHomedir,
} = vi.hoisted(() => {
  const mockStore = {
    session: {} as Record<string, unknown>,
    subscribe: vi.fn(() => vi.fn()),
    setLoginUrl: vi.fn(),
    setOAuthComplete: vi.fn(),
    setFrameworkConfig: vi.fn(),
    setDetectedFramework: vi.fn(),
    setDetectionComplete: vi.fn(),
    setFrameworkContext: vi.fn(),
    addDiscoveredFeature: vi.fn(),
  };
  return {
    mockStore,
    mockPerformAmplitudeAuth: vi.fn(),
    mockFetchAmplitudeUser: vi.fn(),
    mockStoreToken: vi.fn(),
    mockGetStoredUser: vi.fn(),
    mockGetStoredToken: vi.fn(),
    mockAmpliConfigExists: vi.fn(),
    mockIsNonInteractiveEnvironment: vi.fn().mockReturnValue(false),
    mockHomedir: vi.fn().mockReturnValue('/tmp'),
  };
});

// ── Module mocks ───────────────────────────────────────────────────────────────

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
    store: mockStore,
  }),
}));
vi.mock('../lib/wizard-session', () => ({
  // Real buildSession includes region: null by default; mirror that so the
  // auth-task region-wait logic sees null (not undefined) and subscribes.
  buildSession: (args: Record<string, unknown>) => ({ region: null, ...args }),
  DiscoveredFeature: { Stripe: 'stripe', LLM: 'llm' },
}));
vi.mock('../lib/registry', () => ({ FRAMEWORK_REGISTRY: {} }));
vi.mock('../lib/constants', () => ({
  DETECTION_TIMEOUT_MS: 100,
  IS_DEV: true,
  DEFAULT_AMPLITUDE_ZONE: 'us',
}));
vi.mock('../utils/oauth', () => ({
  performAmplitudeAuth: mockPerformAmplitudeAuth,
}));
vi.mock('../lib/api', () => ({
  fetchAmplitudeUser: mockFetchAmplitudeUser,
}));
vi.mock('../utils/ampli-settings', () => ({
  storeToken: mockStoreToken,
  getStoredUser: mockGetStoredUser,
  getStoredToken: mockGetStoredToken,
}));
vi.mock('../lib/ampli-config', () => ({
  ampliConfigExists: mockAmpliConfigExists,
}));
vi.mock('../utils/environment', () => ({
  isNonInteractiveEnvironment: mockIsNonInteractiveEnvironment,
}));
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: mockHomedir };
});

// ── Test helpers ───────────────────────────────────────────────────────────────

async function runCLI(args: string[]) {
  process.argv = ['node', 'bin.ts', ...args];
  vi.resetModules();
  await import('../../bin.ts');
  await new Promise((resolve) => setImmediate(resolve));
}

/** Poll until fn() returns true or timeout elapses. */
async function waitFor(fn: () => boolean, timeout = 2000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!fn()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

function defaultAuthMocks() {
  mockAmpliConfigExists.mockReturnValue(true);
  mockPerformAmplitudeAuth.mockResolvedValue({
    accessToken: 'access-abc',
    idToken: 'id-abc',
    refreshToken: 'refresh-abc',
    zone: 'us',
  });
  mockFetchAmplitudeUser.mockResolvedValue({
    id: 'user-1',
    firstName: 'Test',
    lastName: 'User',
    email: 'test@example.com',
    orgs: [],
  });
}

/**
 * Configure subscribe to immediately deliver a region selection.
 * bin.ts sets session.region = null (via buildSession), then waits for the
 * subscribe callback before starting OAuth. This helper simulates the user
 * picking a region in the TUI.
 */
function simulateRegionSelect(region: 'us' | 'eu') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockStore.subscribe as any).mockImplementation((cb: () => void) => {
    mockStore.session = { ...mockStore.session, region };
    setTimeout(cb, 0);
    return vi.fn();
  });
}

// ── CI mode validation ─────────────────────────────────────────────────────────

describe('CI mode validation', () => {
  const originalArgv = process.argv;
  const originalExit = process.exit;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exit = vi.fn() as unknown as typeof process.exit;
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
    vi.resetModules();
  });

  test('requires --api-key when --ci is set', async () => {
    await runCLI(['--ci', '--install-dir', '/tmp/test']);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test('requires --install-dir when --ci is set', async () => {
    await runCLI(['--ci', '--api-key', 'phx_test']);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test('passes --api-key to runWizard in CI mode', async () => {
    await runCLI(['--ci', '--api-key', 'phx_test_key', '--install-dir', '/tmp/test']);
    expect(mockRunWizard).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'phx_test_key' }),
    );
  });

  test('ci flag is false by default in interactive mode', async () => {
    defaultAuthMocks();
    simulateRegionSelect('us');

    await runCLI([]);
    await waitFor(() => mockRunWizard.mock.calls.length > 0);

    expect(mockRunWizard).toHaveBeenCalledWith(
      expect.objectContaining({ ci: false }),
      expect.anything(),
    );
  });
});

// ── TUI auth task: region determines OAuth zone ────────────────────────────────

describe('TUI auth task: region determines OAuth zone', () => {
  const originalArgv = process.argv;
  const originalExit = process.exit;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exit = vi.fn() as unknown as typeof process.exit;
    mockIsNonInteractiveEnvironment.mockReturnValue(false);
    defaultAuthMocks();
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
    vi.resetModules();
  });

  test('passes us zone to OAuth when region is us', async () => {
    simulateRegionSelect('us');

    await runCLI([]);
    await waitFor(() => mockPerformAmplitudeAuth.mock.calls.length > 0);

    expect(mockPerformAmplitudeAuth).toHaveBeenCalledWith(
      expect.objectContaining({ zone: 'us' }),
    );
  });

  test('passes eu zone to OAuth when region is eu', async () => {
    simulateRegionSelect('eu');

    await runCLI([]);
    await waitFor(() => mockPerformAmplitudeAuth.mock.calls.length > 0);

    expect(mockPerformAmplitudeAuth).toHaveBeenCalledWith(
      expect.objectContaining({ zone: 'eu' }),
    );
  });

  test('waits for region before starting OAuth', async () => {
    let storedCallback: (() => void) | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockStore.subscribe as any).mockImplementation((cb: () => void) => {
      storedCallback = cb; // capture but do NOT call yet
      return vi.fn();
    });

    const cliPromise = runCLI([]);

    // OAuth must not start until region is delivered
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPerformAmplitudeAuth).not.toHaveBeenCalled();

    // Simulate the user picking a region
    mockStore.session = { ...mockStore.session, region: 'us' };
    (storedCallback as (() => void) | null)?.();

    await cliPromise;
    await waitFor(() => mockPerformAmplitudeAuth.mock.calls.length > 0);

    expect(mockPerformAmplitudeAuth).toHaveBeenCalledWith(
      expect.objectContaining({ zone: 'us' }),
    );
  });

  test('forceFresh is false when ampli.json exists (returning user)', async () => {
    mockAmpliConfigExists.mockReturnValue(true);
    simulateRegionSelect('us');

    await runCLI([]);
    await waitFor(() => mockPerformAmplitudeAuth.mock.calls.length > 0);

    expect(mockPerformAmplitudeAuth).toHaveBeenCalledWith(
      expect.objectContaining({ forceFresh: false }),
    );
  });

  test('forceFresh is true when no ampli.json (new project)', async () => {
    mockAmpliConfigExists.mockReturnValue(false);
    simulateRegionSelect('us');

    await runCLI([]);
    await waitFor(() => mockPerformAmplitudeAuth.mock.calls.length > 0);

    expect(mockPerformAmplitudeAuth).toHaveBeenCalledWith(
      expect.objectContaining({ forceFresh: true }),
    );
  });

  test('stores token and signals AuthScreen after OAuth completes', async () => {
    simulateRegionSelect('us');

    await runCLI([]);
    await waitFor(() => mockStore.setOAuthComplete.mock.calls.length > 0);

    expect(mockStoreToken).toHaveBeenCalled();
    expect(mockStore.setOAuthComplete).toHaveBeenCalledWith(
      expect.objectContaining({ idToken: 'id-abc', cloudRegion: 'us' }),
    );
  });
});

// ── Feature discovery ──────────────────────────────────────────────────────────

describe('Feature discovery', () => {
  const originalArgv = process.argv;
  const originalExit = process.exit;
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exit = vi.fn() as unknown as typeof process.exit;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amp-wizard-feat-test-'));
    mockIsNonInteractiveEnvironment.mockReturnValue(false);
    defaultAuthMocks();
    simulateRegionSelect('us');
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.resetModules();
  });

  function writePkgJson(deps: Record<string, string>, devDeps?: Record<string, string>) {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: deps, devDependencies: devDeps ?? {} }),
      'utf-8',
    );
  }

  test('detects stripe dependency', async () => {
    writePkgJson({ stripe: '^15.0.0' });

    await runCLI(['--install-dir', tmpDir]);
    await waitFor(() => mockStore.addDiscoveredFeature.mock.calls.length > 0);

    expect(mockStore.addDiscoveredFeature).toHaveBeenCalledWith('stripe');
  });

  test('detects @stripe/stripe-js dependency', async () => {
    writePkgJson({ '@stripe/stripe-js': '^4.0.0' });

    await runCLI(['--install-dir', tmpDir]);
    await waitFor(() => mockStore.addDiscoveredFeature.mock.calls.length > 0);

    expect(mockStore.addDiscoveredFeature).toHaveBeenCalledWith('stripe');
  });

  test('detects openai as an LLM dependency', async () => {
    writePkgJson({ openai: '^4.0.0' });

    await runCLI(['--install-dir', tmpDir]);
    await waitFor(() => mockStore.addDiscoveredFeature.mock.calls.length > 0);

    expect(mockStore.addDiscoveredFeature).toHaveBeenCalledWith('llm');
  });

  test('detects @anthropic-ai/sdk as an LLM dependency', async () => {
    writePkgJson({ '@anthropic-ai/sdk': '^0.30.0' });

    await runCLI(['--install-dir', tmpDir]);
    await waitFor(() => mockStore.addDiscoveredFeature.mock.calls.length > 0);

    expect(mockStore.addDiscoveredFeature).toHaveBeenCalledWith('llm');
  });

  test('detects LLM dep in devDependencies', async () => {
    writePkgJson({}, { ai: '^3.0.0' });

    await runCLI(['--install-dir', tmpDir]);
    await waitFor(() => mockStore.addDiscoveredFeature.mock.calls.length > 0);

    expect(mockStore.addDiscoveredFeature).toHaveBeenCalledWith('llm');
  });

  test('no features discovered for unrecognized dependencies', async () => {
    writePkgJson({ react: '^18.0.0', lodash: '^4.0.0' });

    await runCLI(['--install-dir', tmpDir]);
    await waitFor(() => mockStore.setDetectionComplete.mock.calls.length > 0);
    // Extra margin: ensure addDiscoveredFeature would have been called synchronously
    await new Promise((r) => setTimeout(r, 50));

    expect(mockStore.addDiscoveredFeature).not.toHaveBeenCalled();
  });

  test('no crash and no features when package.json is absent', async () => {
    // tmpDir has no package.json
    await runCLI(['--install-dir', tmpDir]);
    await waitFor(() => mockStore.setDetectionComplete.mock.calls.length > 0);

    expect(mockStore.addDiscoveredFeature).not.toHaveBeenCalled();
  });
});

// ── login command ──────────────────────────────────────────────────────────────

describe('login command', () => {
  const originalArgv = process.argv;
  const originalExit = process.exit;
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy.mockClear();
    process.exit = vi.fn() as unknown as typeof process.exit;
    mockPerformAmplitudeAuth.mockResolvedValue({
      accessToken: 'a',
      idToken: 'id',
      refreshToken: 'r',
      zone: 'us',
    });
    mockFetchAmplitudeUser.mockResolvedValue({
      id: '1',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      orgs: [{ name: 'Acme' }],
    });
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
    vi.resetModules();
  });

  test('prints already-logged-in and exits 0 when cached session is valid', async () => {
    mockGetStoredToken.mockReturnValue({ accessToken: 'cached' });
    mockGetStoredUser.mockReturnValue({
      id: 'user-1',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      zone: 'us',
    });

    await runCLI(['login']);
    await waitFor(() => (process.exit as unknown as Mock).mock.calls.length > 0);

    // "Already logged in" should be the first console.log call
    expect(consoleSpy.mock.calls[0]?.[0]).toMatch(/Already logged in/);
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  test('performs OAuth when no cached session exists', async () => {
    mockGetStoredToken.mockReturnValue(null);
    mockGetStoredUser.mockReturnValue(undefined);

    await runCLI(['login']);
    await waitFor(() => (process.exit as unknown as Mock).mock.calls.length > 0);

    expect(mockPerformAmplitudeAuth).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  test('prints logged-in user name and email after OAuth', async () => {
    mockGetStoredToken.mockReturnValue(null);

    await runCLI(['login']);
    await waitFor(() => (process.exit as unknown as Mock).mock.calls.length > 0);

    const allOutput = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(allOutput).toMatch(/Logged in as/);
    expect(allOutput).toMatch(/jane@example\.com/);
  });

  test('exits with code 1 when OAuth fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGetStoredToken.mockReturnValue(null);
    mockPerformAmplitudeAuth.mockRejectedValue(new Error('network error'));

    await runCLI(['login']);
    await waitFor(() => (process.exit as unknown as Mock).mock.calls.length > 0);

    expect(process.exit).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
  });
});

// ── logout command ─────────────────────────────────────────────────────────────

describe('logout command', () => {
  const originalArgv = process.argv;
  const originalExit = process.exit;
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  let tmpHome: string;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy.mockClear();
    process.exit = vi.fn() as unknown as typeof process.exit;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'amp-wizard-home-test-'));
    mockHomedir.mockReturnValue(tmpHome);
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    vi.resetModules();
  });

  test('clears config and prints confirmation when user was logged in', async () => {
    mockGetStoredUser.mockReturnValue({ email: 'jane@example.com' });

    await runCLI(['logout']);
    await waitFor(() => (process.exit as unknown as Mock).mock.calls.length > 0);

    expect(process.exit).toHaveBeenCalledWith(0);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('jane@example.com'));
  });

  test('prints no-session message when not logged in', async () => {
    mockGetStoredUser.mockReturnValue(null);

    await runCLI(['logout']);
    await waitFor(() => (process.exit as unknown as Mock).mock.calls.length > 0);

    expect(process.exit).toHaveBeenCalledWith(0);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No active session'));
  });
});

// ── whoami command ─────────────────────────────────────────────────────────────

describe('whoami command', () => {
  const originalArgv = process.argv;
  const originalExit = process.exit;
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy.mockClear();
    process.exit = vi.fn() as unknown as typeof process.exit;
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
    vi.resetModules();
  });

  test('shows user name and email when logged in', async () => {
    mockGetStoredUser.mockReturnValue({
      id: 'user-1',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      zone: 'us',
    });
    mockGetStoredToken.mockReturnValue({ accessToken: 'token' });

    await runCLI(['whoami']);
    await waitFor(() => (process.exit as unknown as Mock).mock.calls.length > 0);

    const allOutput = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(allOutput).toMatch(/Jane Doe/);
    expect(allOutput).toMatch(/jane@example\.com/);
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  test('shows not-logged-in message when no token', async () => {
    mockGetStoredUser.mockReturnValue(null);
    mockGetStoredToken.mockReturnValue(null);

    await runCLI(['whoami']);
    await waitFor(() => (process.exit as unknown as Mock).mock.calls.length > 0);

    const allOutput = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(allOutput).toMatch(/Not logged in/);
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  test('prints zone for EU users', async () => {
    mockGetStoredUser.mockReturnValue({
      id: 'user-2',
      firstName: 'Jean',
      lastName: 'Dupont',
      email: 'jean@eu.com',
      zone: 'eu',
    });
    mockGetStoredToken.mockReturnValue({ accessToken: 'token' });

    await runCLI(['whoami']);
    await waitFor(() => (process.exit as unknown as Mock).mock.calls.length > 0);

    const allOutput = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(allOutput).toMatch(/eu/);
  });
});

// ── Legacy / argument parsing (kept for regression coverage) ──────────────────

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
