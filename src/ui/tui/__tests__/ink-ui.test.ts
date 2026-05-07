import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { InkUI } from '../ink-ui.js';
import { WizardStore } from '../store.js';
import { OutroKind } from '../../../lib/wizard-session.js';
import { analytics } from '../../../utils/analytics.js';

vi.mock('../../../utils/analytics.js', () => ({
  analytics: {
    capture: vi.fn(),
    captureException: vi.fn(),
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    setSessionProperty: vi.fn(),
    setDistinctId: vi.fn(),
    identifyUser: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    isFeatureFlagEnabled: vi.fn().mockReturnValue(true),
  },
  sessionProperties: vi.fn(() => ({})),
  sessionPropertiesCompact: vi.fn(() => ({})),
}));

vi.mock('../../../utils/api-key-store.js', () => ({
  clearApiKey: vi.fn(),
  persistApiKey: vi.fn(),
  readApiKeyWithSource: vi.fn(),
}));

const wizardCaptureMock = analytics.wizardCapture as Mock;

describe('InkUI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('outro()', () => {
    it('fires "outro reached" exactly once when outroData is already set', async () => {
      // Regression: previously the else branch re-called setOutroData(),
      // which fires 'outro reached' analytics. Combined with the
      // agent-runner success path's preceding setOutroData() call, this
      // double-fired the event on every successful completion.
      const store = new WizardStore();
      const ui = new InkUI(store);

      // Simulate the agent-runner success-path setup: caller fires the
      // rich payload first, then calls outro() which should defensively
      // re-emit without re-firing analytics.
      ui.setOutroData({ kind: OutroKind.Success, message: 'Done!' });
      const callsAfterSetup = wizardCaptureMock.mock.calls.filter(
        (c) => c[0] === 'outro reached',
      ).length;
      expect(callsAfterSetup).toBe(1);

      ui.outro('Successfully installed!');

      const totalOutroReached = wizardCaptureMock.mock.calls.filter(
        (c) => c[0] === 'outro reached',
      ).length;
      expect(totalOutroReached).toBe(1);
    });

    it('still notifies subscribers when outroData is already set', () => {
      const store = new WizardStore();
      const ui = new InkUI(store);
      ui.setOutroData({ kind: OutroKind.Success, message: 'Done!' });

      const listener = vi.fn();
      store.subscribe(listener);
      ui.outro('Successfully installed!');

      expect(listener).toHaveBeenCalled();
    });

    it('fires "outro reached" once when outroData is not yet set', () => {
      const store = new WizardStore();
      const ui = new InkUI(store);

      ui.outro('Successfully installed!');

      const totalOutroReached = wizardCaptureMock.mock.calls.filter(
        (c) => c[0] === 'outro reached',
      ).length;
      expect(totalOutroReached).toBe(1);
    });
  });

  describe('cancel()', () => {
    it('does not double-fire "outro reached" on the bash-deny circuit-breaker path', async () => {
      // Regression: the bash-deny circuit breaker calls setOutroData()
      // (analytics #1), then wizardAbort calls cancel() — which used to
      // re-call setOutroData in its else branch (analytics #2).
      const store = new WizardStore();
      const ui = new InkUI(store);

      ui.setOutroData({
        kind: OutroKind.Error,
        message: 'Bash deny circuit breaker tripped',
        canRestart: true,
      });

      // Use a quick race so the cancel() promise doesn't block on
      // outroDismissed; we only care about the synchronous analytics
      // side-effect under the if/else branch.
      const cancelPromise = ui.cancel('Bash deny circuit breaker tripped');
      // Resolve outroDismissed by signalling it.
      store.signalOutroDismissed();
      await cancelPromise;

      const totalOutroReached = wizardCaptureMock.mock.calls.filter(
        (c) => c[0] === 'outro reached',
      ).length;
      expect(totalOutroReached).toBe(1);
    });
  });
});
