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
});
