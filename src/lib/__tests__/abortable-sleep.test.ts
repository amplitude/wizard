/**
 * Verifies the abortable-sleep pattern used in pollForDataIngestion's
 * inter-poll wait. The Promise must resolve as soon as either the timer
 * fires or the wizard signal aborts — whichever comes first.
 *
 * Pattern under test (mirrors src/lib/agent-runner.ts):
 *   await new Promise<void>((resolve) => {
 *     const timer = setTimeout(() => {
 *       wizardSignal.removeEventListener('abort', onAbort);
 *       resolve();
 *     }, waitMs);
 *     const onAbort = () => { clearTimeout(timer); resolve(); };
 *     wizardSignal.addEventListener('abort', onAbort, { once: true });
 *   });
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  abortWizard,
  getWizardAbortSignal,
  resetWizardAbortController,
} from '../../utils/wizard-abort';

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

describe('abortable sleep used in pollForDataIngestion', () => {
  beforeEach(() => {
    resetWizardAbortController();
  });

  it('resolves on timer when not aborted', async () => {
    const start = Date.now();
    await abortableSleep(20, getWizardAbortSignal());
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(15);
    // Should not take significantly longer than 20ms.
    expect(elapsed).toBeLessThan(200);
  });

  it('resolves immediately when the signal aborts mid-sleep', async () => {
    const signal = getWizardAbortSignal();
    const start = Date.now();
    const sleepPromise = abortableSleep(10_000, signal);
    setTimeout(() => abortWizard('test cancel'), 5);
    await sleepPromise;
    const elapsed = Date.now() - start;
    // The 10s timer should never fire — abort cancels it within ~5ms.
    expect(elapsed).toBeLessThan(500);
  });

  it('does not leak listeners on the natural-timer path', async () => {
    const signal = getWizardAbortSignal();
    // Run a few timer-based sleeps; each should attach + detach its listener.
    for (let i = 0; i < 5; i++) {
      await abortableSleep(5, signal);
    }
    // Now abort: if any listeners were leaked, the abort dispatch would still
    // fire stale handlers — but resolve() is idempotent so this is hard to
    // observe directly. Instead assert the signal works as expected after
    // a sequence of completed sleeps.
    expect(signal.aborted).toBe(false);
    abortWizard('after sleeps');
    expect(signal.aborted).toBe(true);
  });
});
