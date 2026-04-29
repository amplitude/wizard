import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { type Mock } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Skip the per-project storage bootstrap (migration shim + project log
// file routing) for the entire suite. vitest module mocks don't always
// intercept the dynamic-import chain bin.ts uses, and CLI tests aren't
// exercising storage migration anyway — there's a dedicated test suite
// for that. This must be set BEFORE bin.ts is imported.
process.env.AMPLITUDE_WIZARD_SKIP_BOOTSTRAP = '1';

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
  mockTrackWizardFeedback,
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
    autoEnableInlineAddons: vi.fn(),
    onEnterScreen: vi.fn(),
    completeSetup: vi.fn(),
    setAmplitudePreDetected: vi.fn(),
    waitForPreDetectedChoice: vi.fn().mockResolvedValue(false),
    resetForAgentAfterPreDetected: vi.fn(),
    setOutroData: vi.fn(),
    setRunPhase: vi.fn(),
    setUserEmail: vi.fn(),
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
    mockTrackWizardFeedback: vi.fn().mockResolvedValue(undefined),
  };
});

// ── Module mocks ───────────────────────────────────────────────────────────────

const mockRunWizard = vi.fn();
const mockDetectAllFrameworks = vi.fn().mockResolvedValue([]);

vi.mock('../run', () => ({
  runWizard: mockRunWizard,
  detectAllFrameworks: mockDetectAllFrameworks,
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
  // Real buildSession includes region: null and credentials: null by default;
  // mirror that so the auth-task checks behave correctly in tests.
  // Also mirrors the schema's `acceptTos → tosAccepted` translation so
  // runDirectSignupIfRequested's missing-flags gate sees the right value.
  buildSession: (args: Record<string, unknown>) => ({
    region: null,
    credentials: null,
    frameworkContext: {},
    frameworkContextAnswerOrder: [],
    apiKeyNotice: null,
    ...args,
    tosAccepted: args.acceptTos === true ? true : null,
  }),
  DiscoveredFeature: { Stripe: 'stripe', LLM: 'llm' },
}));
vi.mock('../lib/registry', () => ({ FRAMEWORK_REGISTRY: {} }));
vi.mock('../lib/constants', () => ({
  DETECTION_TIMEOUT_MS: 100,
  IS_DEV: true,
  DEFAULT_AMPLITUDE_ZONE: 'us',
  DEFAULT_HOST_URL: 'https://api.amplitude.com',
  EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  TERMS_OF_SERVICE_URL: 'https://amplitude.com/terms',
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
  clearStoredCredentials: vi.fn(),
}));
vi.mock('../lib/ampli-config', () => ({
  ampliConfigExists: mockAmpliConfigExists,
  readAmpliConfig: vi.fn().mockReturnValue({ ok: false }),
}));
vi.mock('../utils/api-key-store', () => ({
  readApiKeyWithSource: vi.fn().mockReturnValue(null),
  persistApiKey: vi.fn().mockReturnValue('env'),
  clearApiKey: vi.fn(),
}));
vi.mock('../utils/get-api-key', () => ({
  getAPIKey: vi.fn().mockResolvedValue(null),
}));
vi.mock('../lib/credential-resolution', () => ({
  resolveCredentials: vi.fn().mockResolvedValue(undefined),
  resolveEnvironmentSelection: vi.fn().mockResolvedValue(false),
}));
vi.mock('../utils/environment', () => ({
  isNonInteractiveEnvironment: mockIsNonInteractiveEnvironment,
}));
vi.mock('../utils/track-wizard-feedback.js', () => ({
  trackWizardFeedback: mockTrackWizardFeedback,
}));
vi.mock('../lib/feature-flags', () => ({
  initFeatureFlags: vi.fn().mockResolvedValue(undefined),
  isFlagEnabled: vi.fn().mockReturnValue(true),
  getFlag: vi.fn().mockReturnValue(undefined),
  getAllFlags: vi.fn().mockReturnValue({}),
  FLAG_LLM_ANALYTICS: 'wizard-llm-analytics',
  FLAG_AGENT_ANALYTICS: 'wizard-agent-analytics',
}));
vi.mock('../utils/analytics', () => ({
  analytics: {
    applyOptOut: vi.fn(),
    capture: vi.fn(),
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    setSessionProperty: vi.fn(),
    setDistinctId: vi.fn(),
    identifyUser: vi.fn(),
    getAnonymousId: vi.fn().mockReturnValue('mock-anonymous-id'),
    shutdown: vi.fn().mockResolvedValue(undefined),
    isFeatureFlagEnabled: vi.fn().mockReturnValue(true),
    initFlags: vi.fn().mockResolvedValue(undefined),
    refreshFlags: vi.fn().mockResolvedValue(undefined),
  },
  sessionProperties: vi.fn(() => ({})),
  sessionPropertiesCompact: vi.fn(() => ({})),
}));
vi.mock('../lib/detect-amplitude', () => ({
  detectAmplitudeInProject: vi.fn().mockReturnValue({ confidence: 'none' }),
}));
vi.mock('../utils/signup-or-auth', async () => {
  const actual = await vi.importActual<
    typeof import('../utils/signup-or-auth')
  >('../utils/signup-or-auth');
  return {
    ...actual,
    performSignupOrAuth: vi.fn(),
  };
});
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

/**
 * Poll until fn() returns true or timeout elapses.
 *
 * The default ceiling has to be generous because each cli test rebuilds
 * the bin.ts module graph from scratch. Under parallel test execution
 * with a cold module cache, a 2 s default produced flaky failures on CI
 * (and a fresh local checkout). 8 s absorbs cold-cache penalties without
 * masking real hangs.
 */
async function waitFor(fn: () => boolean, timeout = 8000): Promise<void> {
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
  (mockStore.subscribe as any).mockImplementation((cb: () => void) => {
    mockStore.session = { ...mockStore.session, region, introConcluded: true };
    setTimeout(cb, 0);
    return vi.fn();
  });
}

// ── CI mode validation ─────────────────────────────────────────────────────────

// Each test runs `bin.ts` end-to-end via dynamic import, which transitively
// loads the TUI, framework registry, and observability stack. Under
// parallel test execution with a cold module cache, the first cli test to
// run can blow past the default 5s timeout. The 20s ceiling absorbs that
// without penalizing the steady-state case (each test still completes in
// under 1s).
describe('CI mode validation', { timeout: 20_000 }, () => {
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

  test('invokes runWizard in CI mode without --api-key when --install-dir is set', async () => {
    await runCLI(['--ci', '--install-dir', '/tmp/test']);
    await waitFor(() => mockRunWizard.mock.calls.length > 0, 10_000);

    expect(process.exit).not.toHaveBeenCalled();
    expect(mockRunWizard).toHaveBeenCalledWith(
      expect.objectContaining({ ci: true, installDir: '/tmp/test' }),
      expect.anything(),
      expect.any(Function),
    );
  }, 15_000);

  test('defaults --install-dir to cwd when --ci is set without it', async () => {
    await runCLI(['--ci', '--api-key', 'phx_test']);
    await waitFor(() => mockRunWizard.mock.calls.length > 0);
    expect(process.exit).not.toHaveBeenCalled();
    expect(mockRunWizard).toHaveBeenCalled();
  });

  test('passes --api-key to runWizard in CI mode', async () => {
    await runCLI([
      '--ci',
      '--api-key',
      'phx_test_key',
      '--install-dir',
      '/tmp/test',
    ]);
    await waitFor(() => mockRunWizard.mock.calls.length > 0);
    // CI mode now builds a session with apiKey and passes it as second arg
    expect(mockRunWizard).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'phx_test_key' }),
      expect.objectContaining({ apiKey: 'phx_test_key' }),
      expect.any(Function),
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
      expect.any(Function),
      expect.any(Object),
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

    // Capture only the FIRST subscribe call (the auth task waiting for
    // region + introConcluded). bin.ts also subscribes for feature
    // discovery on integration change — ignore that one in this test.
    (mockStore.subscribe as any).mockImplementation((cb: () => void) => {
      if (!storedCallback) storedCallback = cb;
      return vi.fn();
    });

    const cliPromise = runCLI([]);

    // OAuth must not start until region is delivered
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPerformAmplitudeAuth).not.toHaveBeenCalled();

    // Simulate the user dismissing intro and picking a region
    mockStore.session = {
      ...mockStore.session,
      region: 'us',
      introConcluded: true,
    };
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
      expect.objectContaining({
        accessToken: 'access-abc',
        idToken: 'id-abc',
        cloudRegion: 'us',
      }),
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

  function writePkgJson(
    deps: Record<string, string>,
    devDeps?: Record<string, string>,
  ) {
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
  const consoleSpy = vi
    .spyOn(console, 'log')
    .mockImplementation(() => undefined);

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
    await waitFor(
      () => (process.exit as unknown as Mock).mock.calls.length > 0,
    );

    // "Already logged in" should be the first console.log call
    expect(consoleSpy.mock.calls[0]?.[0]).toMatch(/Already logged in/);
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  test('performs OAuth when no cached session exists', async () => {
    mockGetStoredToken.mockReturnValue(null);
    mockGetStoredUser.mockReturnValue(undefined);

    await runCLI(['login']);
    await waitFor(
      () => (process.exit as unknown as Mock).mock.calls.length > 0,
    );

    expect(mockPerformAmplitudeAuth).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  test('prints logged-in user name and email after OAuth', async () => {
    mockGetStoredToken.mockReturnValue(null);

    await runCLI(['login']);
    await waitFor(
      () => (process.exit as unknown as Mock).mock.calls.length > 0,
    );

    const allOutput = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(allOutput).toMatch(/Logged in as/);
    expect(allOutput).toMatch(/jane@example\.com/);
  });

  test('exits with code 1 when OAuth fails', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockGetStoredToken.mockReturnValue(null);
    mockPerformAmplitudeAuth.mockRejectedValue(new Error('network error'));

    await runCLI(['login']);
    await waitFor(
      () => (process.exit as unknown as Mock).mock.calls.length > 0,
    );

    expect(process.exit).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
  });
});

// ── logout command ─────────────────────────────────────────────────────────────

describe('logout command', () => {
  const originalArgv = process.argv;
  const originalExit = process.exit;
  const consoleSpy = vi
    .spyOn(console, 'log')
    .mockImplementation(() => undefined);
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
    await waitFor(
      () => (process.exit as unknown as Mock).mock.calls.length > 0,
    );

    expect(process.exit).toHaveBeenCalledWith(0);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('jane@example.com'),
    );
  });

  test('prints no-session message when not logged in', async () => {
    mockGetStoredUser.mockReturnValue(null);

    await runCLI(['logout']);
    await waitFor(
      () => (process.exit as unknown as Mock).mock.calls.length > 0,
    );

    expect(process.exit).toHaveBeenCalledWith(0);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('No active session'),
    );
  });
});

// ── whoami command ─────────────────────────────────────────────────────────────

describe('whoami command', () => {
  const originalArgv = process.argv;
  const originalExit = process.exit;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Spy inside beforeEach so earlier tests that call mockRestore()
    // on console.error (e.g. login > OAuth failure) don't leave us
    // without a stderr spy when log.error routes there (per C1 / C5).
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleErrSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    process.exit = vi.fn() as unknown as typeof process.exit;
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
    consoleSpy.mockRestore();
    consoleErrSpy.mockRestore();
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
    await waitFor(
      () => (process.exit as unknown as Mock).mock.calls.length > 0,
    );

    const allOutput = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(allOutput).toMatch(/Jane Doe/);
    expect(allOutput).toMatch(/jane@example\.com/);
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  test('shows not-logged-in message when no token', async () => {
    mockGetStoredUser.mockReturnValue(null);
    mockGetStoredToken.mockReturnValue(null);

    await runCLI(['whoami']);
    await waitFor(
      () => (process.exit as unknown as Mock).mock.calls.length > 0,
    );

    // C5 routes the "Not logged in" message through getUI().log.error,
    // which per C1 writes to stderr rather than stdout.
    const allOutput = [
      ...consoleSpy.mock.calls.map((c) => c[0]),
      ...consoleErrSpy.mock.calls.map((c) => c[0]),
    ].join('\n');
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
    await waitFor(
      () => (process.exit as unknown as Mock).mock.calls.length > 0,
    );

    const allOutput = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(allOutput).toMatch(/eu/);
  });
});

// ── feedback command ──────────────────────────────────────────────────────────

describe('feedback command', () => {
  const originalArgv = process.argv;
  const originalExit = process.exit;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Spy inside beforeEach so earlier tests that call mockRestore()
    // on console.error (e.g. login > OAuth failure) don't leave us
    // without a spy on stderr when log.error() routes there.
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleErrSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockTrackWizardFeedback.mockClear();
    process.exit = vi.fn() as unknown as typeof process.exit;
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
    consoleSpy.mockRestore();
    consoleErrSpy.mockRestore();
    vi.resetModules();
  });

  test('exits with error when no message is provided', async () => {
    await runCLI(['feedback']);
    await waitFor(
      () => (process.exit as unknown as Mock).mock.calls.length > 0,
    );

    expect(process.exit).toHaveBeenCalledWith(1);
    // Error message is routed through log.error → console.error (per C1 fix)
    const allOutput = [
      ...consoleSpy.mock.calls.map((c) => c[0]),
      ...consoleErrSpy.mock.calls.map((c) => c[0]),
    ].join('\n');
    expect(allOutput).toMatch(/Usage:/);
    expect(mockTrackWizardFeedback).not.toHaveBeenCalled();
  });

  test('sends positional message and exits 0', async () => {
    await runCLI(['feedback', 'great', 'wizard']);
    await waitFor(
      () => (process.exit as unknown as Mock).mock.calls.length > 0,
    );

    expect(mockTrackWizardFeedback).toHaveBeenCalledWith('great wizard');
    expect(process.exit).toHaveBeenCalledWith(0);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('feedback was sent'),
    );
  });

  test('sends --message and exits 0', async () => {
    await runCLI(['feedback', '--message', 'from flag']);
    await waitFor(
      () => (process.exit as unknown as Mock).mock.calls.length > 0,
    );

    expect(mockTrackWizardFeedback).toHaveBeenCalledWith('from flag');
    expect(process.exit).toHaveBeenCalledWith(0);
  });
});

// ── --email / --full-name flags ───────────────────────────────────────────────

describe('--email and --full-name flags', () => {
  const originalArgv = process.argv;
  const originalExit = process.exit;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exit = vi.fn() as unknown as typeof process.exit;
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
  });

  test('errors when --email is malformed', async () => {
    // Silence yargs error output for this test
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    try {
      await runCLI([
        '--signup',
        '--ci',
        '--email',
        'ada',
        '--full-name',
        'Ada Lovelace',
        '--install-dir',
        '/tmp/test',
      ]);

      // Give any async handlers time to fire
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      stderrSpy.mockRestore();
    }

    // The key invariant: a malformed email must NOT reach runWizard.
    // yargs' coerce failure prevents the command handler from running.
    expect(mockRunWizard).not.toHaveBeenCalled();
  });

  test('errors when --full-name is empty', async () => {
    // Silence yargs error output for this test
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    try {
      await runCLI([
        '--signup',
        '--ci',
        '--email',
        'ada@example.com',
        '--full-name',
        '',
        '--install-dir',
        '/tmp/test',
      ]);

      // Give any async handlers time to fire
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      stderrSpy.mockRestore();
    }

    // The key invariant: an empty full-name must NOT reach runWizard.
    // yargs' coerce failure prevents the command handler from running.
    expect(mockRunWizard).not.toHaveBeenCalled();
  });

  test('accepts --email and --full-name on the default command', async () => {
    await runCLI([
      '--signup',
      '--ci',
      '--email',
      'ada@example.com',
      '--full-name',
      'Ada Lovelace',
      '--accept-tos',
      '--region',
      'us',
      '--install-dir',
      '/tmp/test',
    ]);

    await waitFor(() => mockRunWizard.mock.calls.length > 0);

    // Second arg is the WizardSession built by buildSession — check it contains
    // the signup profile fields passed on the command line.
    expect(mockRunWizard).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        signupEmail: 'ada@example.com',
        signupFullName: 'Ada Lovelace',
        tosAccepted: true,
      }),
      expect.any(Function),
    );
  });

  test('emits agentic signup attempted with status=wrapper_exception when wrapper throws', async () => {
    const { performSignupOrAuth, AGENTIC_SIGNUP_ATTEMPTED_EVENT } =
      await import('../utils/signup-or-auth');
    const { analytics } = await import('../utils/analytics');
    vi.mocked(performSignupOrAuth).mockRejectedValueOnce(new Error('boom'));

    await runCLI([
      '--signup',
      '--ci',
      '--email',
      'ada@example.com',
      '--full-name',
      'Ada Lovelace',
      '--accept-tos',
      // `--region` is required in non-TUI modes — without it, the missing-flags
      // gate in `runDirectSignupIfRequested` exits via INVALID_ARGS before
      // `performSignupOrAuth` is ever called.
      '--region',
      'us',
      '--install-dir',
      '/tmp/test',
    ]);

    await waitFor(() =>
      (analytics.wizardCapture as ReturnType<typeof vi.fn>).mock.calls.some(
        (c) => c[0] === AGENTIC_SIGNUP_ATTEMPTED_EVENT,
      ),
    );

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      AGENTIC_SIGNUP_ATTEMPTED_EVENT,
      expect.objectContaining({
        status: 'wrapper_exception',
        zone: expect.any(String),
      }),
    );
  });

  test('--ci --signup without --accept-tos exits INVALID_ARGS', async () => {
    // `vi.clearAllMocks()` clears call data but not stored implementations,
    // so prior login-suite tests' `mockReturnValue` calls leak. Reset here.
    mockGetStoredUser.mockReturnValue(undefined);
    // Direct override instead of vi.spyOn — vitest's stderr capture
    // intercepts writes before the spy sees them.
    const stderrCalls: string[] = [];
    const origStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      stderrCalls.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      await runCLI([
        '--signup',
        '--ci',
        '--email',
        'ada@example.com',
        '--full-name',
        'Ada Lovelace',
        '--region',
        'us',
        '--install-dir',
        '/tmp/test',
      ]);

      await waitFor(
        () => (process.exit as unknown as Mock).mock.calls.length > 0,
      );
    } finally {
      process.stderr.write = origStderrWrite;
    }

    // Exits with INVALID_ARGS (2) and prints a missing-flags error.
    // (Don't assert mockRunWizard was not called — process.exit is a no-op
    // in tests, so execution falls through to lazyRunWizard. In production
    // the real exit prevents that.)
    expect(process.exit).toHaveBeenCalledWith(2);
    expect(stderrCalls.join('')).toMatch(/--accept-tos/);
  });

  test('--agent --signup with no other flags emits signup_input_required and exits INPUT_REQUIRED', async () => {
    // Reset stored-user implementation leaked from earlier login tests so
    // tryResolveZone returns null (otherwise zone resolves from a prior
    // test's `mockGetStoredUser.mockReturnValue({ zone: 'us', ... })` and
    // --region wouldn't appear in the missing[] list).
    mockGetStoredUser.mockReturnValue(undefined);
    // Direct stdout override — AgentUI emits NDJSON via process.stdout.write
    // which goes through `safePipeWrite` (a non-spy-friendly path).
    const stdoutCalls: string[] = [];
    const origStdoutWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown) => {
      stdoutCalls.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      await runCLI(['--signup', '--agent', '--install-dir', '/tmp/test']);

      await waitFor(
        () => (process.exit as unknown as Mock).mock.calls.length > 0,
      );
    } finally {
      process.stdout.write = origStdoutWrite;
    }

    // Exits with INPUT_REQUIRED (12).
    expect(process.exit).toHaveBeenCalledWith(12);

    // stdout received an NDJSON line with event: 'signup_input_required'
    // listing all four missing flags.
    const events = stdoutCalls
      .join('')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(
        (e): e is { type: string; data?: { event?: string } } => e !== null,
      );
    const signupEvent = events.find(
      (e) => e.data?.event === 'signup_input_required',
    );
    expect(signupEvent).toBeDefined();
    const missingFlags = (
      signupEvent?.data as { missing?: Array<{ flag: string }> } | undefined
    )?.missing?.map((m) => m.flag);
    expect(missingFlags).toEqual(
      expect.arrayContaining([
        '--region',
        '--email',
        '--full-name',
        '--accept-tos',
      ]),
    );
  });
});

// ── Legacy / argument parsing (kept for regression coverage) ──────────────────

describe.skip('CLI argument parsing', () => {
  const originalArgv = process.argv;

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

    test('invokes runWizard without --api-key when --ci and --install-dir are set', async () => {
      await runCLI(['--ci', '--install-dir', '/tmp/test']);
      await waitFor(() => mockRunWizard.mock.calls.length > 0);

      expect(process.exit).not.toHaveBeenCalled();
      expect(mockRunWizard).toHaveBeenCalled();
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
