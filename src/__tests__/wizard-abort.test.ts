import {
  wizardAbort,
  WizardError,
  registerCleanup,
  clearCleanup,
} from '../utils/wizard-abort';
import { analytics } from '../utils/analytics';
import { type Mocked } from 'vitest';
import * as uiModule from '../ui';

vi.mock('../utils/analytics');
vi.mock('../ui', () => ({
  getUI: vi.fn().mockReturnValue({
    outro: vi.fn(),
    cancel: vi.fn(),
  }),
}));

const mockAnalytics = analytics as Mocked<typeof analytics>;
const { getUI } = uiModule as unknown as { getUI: ReturnType<typeof vi.fn> };

describe('wizardAbort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCleanup();

    mockAnalytics.captureException = vi.fn();
    mockAnalytics.shutdown = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls getUI().cancel before analytics.shutdown so wizardCapture events from outro hotkeys are flushed', async () => {
    // Bug 1 from PR 331 review: shutdown used to run before cancel,
    // which meant any analytics.wizardCapture call fired during the
    // interactive Outro (press L for log, C for bug report) was queued
    // after the final flush and silently dropped on process.exit.
    // Lock the new order in: cancel first, then shutdown.
    const callOrder: string[] = [];
    mockAnalytics.shutdown.mockImplementation(async () => {
      callOrder.push('shutdown');
    });
    getUI().cancel.mockImplementation(() => {
      callOrder.push('cancel');
    });

    await expect(wizardAbort()).rejects.toThrow('process.exit called');

    expect(callOrder).toEqual(['cancel', 'shutdown']);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('uses default message and exit code when called with no options', async () => {
    await expect(wizardAbort()).rejects.toThrow('process.exit called');

    expect(getUI().cancel).toHaveBeenCalledWith(
      'Wizard setup cancelled.',
      undefined,
    );
    expect(mockAnalytics.shutdown).toHaveBeenCalledWith('cancelled');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('uses custom message and exit code', async () => {
    await expect(
      wizardAbort({ message: 'Custom failure', exitCode: 2 }),
    ).rejects.toThrow('process.exit called');

    expect(getUI().cancel).toHaveBeenCalledWith('Custom failure', undefined);
    expect(process.exit).toHaveBeenCalledWith(2);
  });

  it('forwards cancelOptions.docsUrl into getUI().cancel', async () => {
    // Used by the version-check cancel path in agent-runner: an
    // unsupported version routes through wizardAbort and we want the
    // "Manual setup guide" link to surface in the Outro.
    await expect(
      wizardAbort({
        message: 'Unsupported version',
        cancelOptions: { docsUrl: 'https://example.com/docs' },
      }),
    ).rejects.toThrow('process.exit called');

    expect(getUI().cancel).toHaveBeenCalledWith('Unsupported version', {
      docsUrl: 'https://example.com/docs',
    });
  });

  it('captures error in analytics and shuts down as error when error is provided', async () => {
    const error = new Error('something broke');

    await expect(wizardAbort({ error })).rejects.toThrow('process.exit called');

    expect(mockAnalytics.captureException).toHaveBeenCalledWith(error, {});
    expect(mockAnalytics.shutdown).toHaveBeenCalledWith('error');
  });

  it('does not capture error when no error is provided', async () => {
    await expect(wizardAbort()).rejects.toThrow('process.exit called');

    expect(mockAnalytics.captureException).not.toHaveBeenCalled();
  });

  it('includes WizardError context in analytics capture', async () => {
    const error = new WizardError('MCP missing', {
      integration: 'nextjs',
      'error type': 'MCP_MISSING',
    });

    await expect(wizardAbort({ error })).rejects.toThrow('process.exit called');

    expect(mockAnalytics.captureException).toHaveBeenCalledWith(error, {
      integration: 'nextjs',
      'error type': 'MCP_MISSING',
    });
  });

  it('runs registered cleanup functions before display, with shutdown after cancel', async () => {
    const callOrder: string[] = [];

    registerCleanup(() => callOrder.push('cleanup1'));
    registerCleanup(() => callOrder.push('cleanup2'));
    mockAnalytics.shutdown.mockImplementation(async () => {
      callOrder.push('shutdown');
    });
    getUI().cancel.mockImplementation(() => {
      callOrder.push('cancel');
    });

    await expect(wizardAbort()).rejects.toThrow('process.exit called');

    expect(callOrder).toEqual(['cleanup1', 'cleanup2', 'cancel', 'shutdown']);
  });

  it('does not block exit when a cleanup function throws', async () => {
    registerCleanup(() => {
      throw new Error('cleanup failed');
    });
    registerCleanup(() => {
      /* this should still run */
    });

    await expect(wizardAbort()).rejects.toThrow('process.exit called');

    expect(mockAnalytics.shutdown).toHaveBeenCalled();
    expect(getUI().cancel).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('shuts down analytics as "cancelled" when no error is provided', async () => {
    await expect(wizardAbort({ message: 'Bad input' })).rejects.toThrow(
      'process.exit called',
    );

    expect(mockAnalytics.shutdown).toHaveBeenCalledWith('cancelled');
  });
});

describe('abort() delegates to wizardAbort()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCleanup();

    mockAnalytics.captureException = vi.fn();
    mockAnalytics.shutdown = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('abort() calls wizardAbort with message and exitCode', async () => {
    const { abort } = await import('../utils/setup-utils.js');

    await expect(abort('Test abort', 3)).rejects.toThrow('process.exit called');

    expect(getUI().cancel).toHaveBeenCalledWith('Test abort', undefined);
    expect(process.exit).toHaveBeenCalledWith(3);
  });

  it('abort() uses defaults when called with no args', async () => {
    const { abort } = await import('../utils/setup-utils.js');

    await expect(abort()).rejects.toThrow('process.exit called');

    expect(getUI().cancel).toHaveBeenCalledWith(
      'Wizard setup cancelled.',
      undefined,
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
