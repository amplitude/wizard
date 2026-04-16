import { type MockedFunction } from 'vitest';
import { runWizard } from '../run';
import { runAgentWizard } from '../lib/agent-runner';
import { analytics } from '../utils/analytics';
import { Integration } from '../lib/constants';

vi.mock('../lib/agent-runner');
vi.mock('../utils/analytics');
vi.mock('../lib/wizard-session', () => ({
  buildSession: (args: Record<string, unknown>) => ({
    debug: false,
    forceInstall: false,
    installDir: process.cwd(),
    ci: false,
    signup: false,
    localMcp: false,
    menu: false,
    setupConfirmed: false,
    integration: null,
    frameworkContext: {},
    typescript: false,
    credentials: null,
    serviceStatus: null,
    outroData: null,
    frameworkConfig: null,
    ...args,
  }),
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
    showSettingsOverride: vi.fn(),
    startRun: vi.fn(),
    setRunError: vi.fn(),
  }),
  setUI: vi.fn(),
}));

const mockRunAgentWizard = runAgentWizard as MockedFunction<
  typeof runAgentWizard
>;
const mockAnalytics = analytics as vi.Mocked<typeof analytics>;

describe('runWizard error handling', () => {
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
});
