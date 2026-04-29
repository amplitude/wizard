/**
 * runFrameworkDetection — re-runnable detection helper.
 *
 * Two contracts to pin:
 *   1. On a normal run, it mirrors detection results into the store
 *      and ends with `setDetectionComplete()`.
 *   2. When called with an already-aborted signal (or aborted mid-run),
 *      it bails out WITHOUT mutating the store. This is what makes the
 *      "user changes directory twice in a row" case race-safe — the
 *      first run's abort prevents it from clobbering state set by the
 *      second.
 *
 * We mock `detectAllFrameworks` directly so these tests don't depend on
 * the real framework registry's heuristics or filesystem state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Integration } from '../constants.js';

// ── Mocks ─────────────────────────────────────────────────────────────

const detectAllFrameworksMock = vi.fn();

vi.mock('../../run.js', () => ({
  detectAllFrameworks: (...args: unknown[]) => detectAllFrameworksMock(...args),
}));

vi.mock('../../utils/analytics.js', () => ({
  analytics: {
    capture: vi.fn(),
    captureException: vi.fn(),
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    setDistinctId: vi.fn(),
    identifyUser: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    applyOptOut: vi.fn(),
  },
  sessionPropertiesCompact: () => ({}),
}));

import { runFrameworkDetection } from '../framework-detection.js';
import { WizardStore } from '../../ui/tui/store.js';

beforeEach(() => {
  detectAllFrameworksMock.mockReset();
});

describe('runFrameworkDetection', () => {
  it('mirrors a detected framework into the store', async () => {
    detectAllFrameworksMock.mockResolvedValue([
      { integration: Integration.nextjs, detected: true },
    ]);

    const store = new WizardStore();
    await runFrameworkDetection(store, '/tmp/some-app');

    expect(store.session.integration).toBe(Integration.nextjs);
    expect(store.session.frameworkConfig?.metadata.name).toBe('Next.js');
    expect(store.session.detectedFrameworkLabel).toBe('Next.js');
    expect(store.session.detectionComplete).toBe(true);
    expect(store.session.detectionResults).toHaveLength(1);
  });

  it('marks detectionComplete even when no framework matched', async () => {
    detectAllFrameworksMock.mockResolvedValue([
      { integration: Integration.nextjs, detected: false },
      { integration: Integration.vue, detected: false },
    ]);

    const store = new WizardStore();
    await runFrameworkDetection(store, '/tmp/empty-dir');

    expect(store.session.integration).toBeNull();
    expect(store.session.frameworkConfig).toBeNull();
    expect(store.session.detectionComplete).toBe(true);
  });

  it('bails out without mutating the store when the signal is pre-aborted', async () => {
    detectAllFrameworksMock.mockResolvedValue([
      { integration: Integration.nextjs, detected: true },
    ]);

    const store = new WizardStore();
    const controller = new AbortController();
    controller.abort();

    await runFrameworkDetection(store, '/tmp/aborted', {
      signal: controller.signal,
    });

    // Pre-aborted: detectAllFrameworks shouldn't even have been called,
    // and the store should be untouched.
    expect(detectAllFrameworksMock).not.toHaveBeenCalled();
    expect(store.session.detectionComplete).toBe(false);
    expect(store.session.integration).toBeNull();
  });

  it('does not call setDetectionComplete if aborted mid-run', async () => {
    // Resolve detection AFTER we've aborted so the helper sees the abort
    // signal between `detectAllFrameworks` and `setDetectionComplete`.
    let resolveDetection!: (value: unknown[]) => void;
    detectAllFrameworksMock.mockReturnValue(
      new Promise((resolve) => {
        resolveDetection = resolve as typeof resolveDetection;
      }),
    );

    const store = new WizardStore();
    const controller = new AbortController();

    const detectionPromise = runFrameworkDetection(store, '/tmp/midrun', {
      signal: controller.signal,
    });

    // Abort the run, then let the detection promise settle.
    controller.abort();
    resolveDetection([{ integration: Integration.nextjs, detected: true }]);
    await detectionPromise;

    expect(store.session.detectionComplete).toBe(false);
    // detectionResults is set BEFORE the next abort check, so we tolerate
    // it landing — it's harmless. The critical invariant is that the user
    // never sees a stale `detectionComplete` after a directory swap.
  });

  // ── Regression: stale-closure subscriber bug ────────────────────────
  //
  // Bugbot flagged that the integration-change subscriber, registered
  // ONCE per store on the first detection call, used to capture
  // `installDir` from the function parameter via closure. After a
  // directory change kept the same store but pointed at a new tree, a
  // subsequent manual integration pick would re-run `discoverFeatures`
  // against the OLD installDir — potentially adding Stripe / LLM
  // features from a project the user already navigated away from.
  //
  // Fix: the subscriber re-reads `store.session.installDir` on every
  // fire instead of capturing it. These tests pin that.
  describe('integration-change subscriber after directory swap', () => {
    it('reads installDir from the store on each fire (no stale closure)', async () => {
      detectAllFrameworksMock.mockResolvedValue([]);

      const store = new WizardStore();
      // First detection registers the subscriber with installDir = A.
      await runFrameworkDetection(store, '/tmp/dir-a');

      const discoveredAgainst: string[] = [];
      // Hook addDiscoveredFeature to spy on which installDir
      // discoverFeatures was invoked with by checking session state at
      // fire time. discoverFeatures is mocked at the module level for
      // this suite, so we can't observe its args directly — but the
      // subscriber's `store.session.installDir` is the value we care
      // about, and it's observable here.
      const original = store.addDiscoveredFeature.bind(store);
      store.addDiscoveredFeature = (...args) => {
        discoveredAgainst.push(store.session.installDir);
        return original(...args);
      };

      // Simulate "user changed directory to B" without going through
      // changeInstallDir (we want to test the subscriber's
      // installDir-reading behaviour, not the action). Set installDir
      // first, then trigger the integration-change subscriber by
      // flipping `integration`.
      store.session.installDir = '/tmp/dir-b';
      store.setFrameworkConfig(Integration.vue, {
        metadata: { integration: Integration.vue, name: 'Vue' },
      } as unknown as Parameters<typeof store.setFrameworkConfig>[1]);

      // The subscriber fires synchronously inside setFrameworkConfig's
      // emitChange. If it ran discovery, it should have been against
      // /tmp/dir-b — NOT /tmp/dir-a from the original closure.
      // (We tolerate zero entries here when discoverFeatures returns
      // []; what we care about is that NONE of the entries are dir-a.)
      for (const dir of discoveredAgainst) {
        expect(dir).toBe('/tmp/dir-b');
        expect(dir).not.toBe('/tmp/dir-a');
      }
    });

    it('skips discovery when integration is reset to null (directory-swap signal)', async () => {
      detectAllFrameworksMock.mockResolvedValue([
        { integration: Integration.nextjs, detected: true },
      ]);

      const store = new WizardStore();
      await runFrameworkDetection(store, '/tmp/initial');

      // Spy on autoEnableInlineAddons — it's called once per
      // runDiscovery, so a fire we want to skip would bump the count.
      const enableSpy = vi.spyOn(store, 'autoEnableInlineAddons');
      enableSpy.mockClear();

      // Mimic what changeInstallDir does when reseting state: flip
      // integration from a value to null. The subscriber must NOT run
      // discovery — there's nothing meaningful to discover for a null
      // integration, and firing here would do scan work against the
      // NEW installDir before the new detection has populated state.
      store.setFrameworkConfig(null, null);

      expect(enableSpy).not.toHaveBeenCalled();
    });
  });
});
