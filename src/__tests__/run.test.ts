import { type MockedFunction } from 'vitest';
import { runWizard } from '../run';
import { runAgentWizard } from '../lib/agent-runner';
import { analytics } from '../utils/analytics';
import { Integration } from '../lib/constants';

vi.mock('../lib/agent-runner');
vi.mock('../utils/analytics');
vi.mock('../lib/wizard-session', () => ({
  buildSession: (args: Record<string, unknown>) => {
    const {
      signup,
      accountCreationFlow: acf,
      ...rest
    } = args as Record<string, unknown> & {
      signup?: boolean;
      accountCreationFlow?: boolean;
    };
    return {
      debug: false,
      forceInstall: false,
      installDir: process.cwd(),
      ci: false,
      localMcp: false,
      menu: false,
      setupConfirmed: false,
      integration: null,
      frameworkContext: {},
      frameworkContextAnswerOrder: [],
      typescript: false,
      credentials: null,
      serviceStatus: null,
      outroData: null,
      frameworkConfig: null,
      ...rest,
      accountCreationFlow: Boolean(acf ?? signup ?? false),
    };
  },
}));
vi.mock('../ui', () => ({
  getUI: vi.fn().mockReturnValue({
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
      step: vi.fn(),
    },
    intro: vi.fn(),
    outro: vi.fn(),
    cancel: vi.fn(),
    note: vi.fn(),
    spinner: vi.fn().mockReturnValue({
      start: vi.fn(),
      stop: vi.fn(),
      message: vi.fn(),
    }),
    setDetectedFramework: vi.fn(),
    setCredentials: vi.fn(),
    pushStatus: vi.fn(),
    syncTodos: vi.fn(),
    setLoginUrl: vi.fn(),
    showServiceStatus: vi.fn(),
    startRun: vi.fn(),
    setRunError: vi.fn(),
  }),
  setUI: vi.fn(),
}));

const mockRunAgentWizard = runAgentWizard as MockedFunction<
  typeof runAgentWizard
>;
const mockAnalytics = analytics as vi.Mocked<typeof analytics>;

// Bump the per-test timeout for this suite. Each test runs in <1.5s in
// isolation, but under the cold-cache parallel pressure of `pnpm test`
// (which spins up 156 test files concurrently) module loading for
// `../run` plus its transitive imports — TUI, agent-runner, observability,
// nanostores — pushes past vitest's default 5s timeout intermittently.
// 30s is generous enough that we never hit it on a healthy machine and
// keep the suite green under load. Real bugs would fail well below 30s.
describe('runWizard error handling', { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockAnalytics.setTag = vi.fn();
    mockAnalytics.setSessionProperty = vi.fn();
    mockAnalytics.captureException = vi.fn();
    mockAnalytics.shutdown = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should capture exception and shutdown analytics on wizard error', async () => {
    const testError = new Error('Wizard failed');
    const testArgs = {
      integration: Integration.nextjs,
      debug: true,
      forceInstall: false,
    };

    mockRunAgentWizard.mockRejectedValue(testError);

    await expect(runWizard(testArgs)).rejects.toThrow('process.exit called');

    expect(mockAnalytics.captureException).toHaveBeenCalledWith(testError, {});

    expect(mockAnalytics.shutdown).toHaveBeenCalledWith('error');
  });

  it('should not call captureException when wizard succeeds', async () => {
    const testArgs = { integration: Integration.nextjs };

    mockRunAgentWizard.mockResolvedValue(undefined);

    await runWizard(testArgs);

    expect(mockAnalytics.captureException).not.toHaveBeenCalled();
    expect(mockAnalytics.shutdown).not.toHaveBeenCalled();
  });

  it('passes account creation flow=true to session started when --signup is set', async () => {
    mockAnalytics.wizardCapture = vi.fn();
    const testArgs = {
      integration: Integration.nextjs,
      signup: true,
    };

    mockRunAgentWizard.mockResolvedValue(undefined);

    await runWizard(testArgs);

    expect(mockAnalytics.wizardCapture).toHaveBeenCalledWith(
      'session started',
      expect.objectContaining({ 'account creation flow': true }),
    );
  });

  it('passes account creation flow=false to session started when --signup is unset', async () => {
    mockAnalytics.wizardCapture = vi.fn();
    const testArgs = {
      integration: Integration.nextjs,
    };

    mockRunAgentWizard.mockResolvedValue(undefined);

    await runWizard(testArgs);

    expect(mockAnalytics.wizardCapture).toHaveBeenCalledWith(
      'session started',
      expect.objectContaining({ 'account creation flow': false }),
    );
  });

  // The TUI's directory picker mutates session.installDir at runtime.
  // runWizard MUST treat the passed-in session as the source of truth
  // and not re-derive installDir from CLI argv — doing that silently
  // reverts the user's directory change. See PR #485 follow-up.
  describe('installDir precedence', () => {
    it('preserves session.installDir when a session is passed in (TUI selection wins over argv)', async () => {
      mockRunAgentWizard.mockResolvedValue(undefined);
      const session = {
        debug: false,
        forceInstall: false,
        installDir: '/picked/by/tui',
        ci: false,
        signup: false,
        localMcp: false,
        menu: false,
        setupConfirmed: false,
        integration: Integration.nextjs,
        frameworkContext: {},
        frameworkContextAnswerOrder: [],
        typescript: false,
        credentials: null,
        serviceStatus: null,
        outroData: null,
        frameworkConfig: null,
      } as unknown as Parameters<typeof runWizard>[1];

      // argv carries a different --install-dir; the session value MUST win.
      await runWizard({ installDir: '/from/argv' }, session);

      expect(session.installDir).toBe('/picked/by/tui');
      const passedSession = mockRunAgentWizard.mock.calls[0][1];
      expect(passedSession.installDir).toBe('/picked/by/tui');
    });

    it('uses argv.installDir when no session is provided (fresh build)', async () => {
      mockRunAgentWizard.mockResolvedValue(undefined);

      await runWizard({
        integration: Integration.nextjs,
        installDir: '/from/argv',
      });

      const passedSession = mockRunAgentWizard.mock.calls[0][1];
      expect(passedSession.installDir).toBe('/from/argv');
    });
  });
});
