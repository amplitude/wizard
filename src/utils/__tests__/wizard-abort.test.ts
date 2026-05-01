import { describe, it, expect, beforeEach } from 'vitest';
import {
  getWizardAbortController,
  getWizardAbortSignal,
  abortWizard,
  resetWizardAbortController,
} from '../wizard-abort';

describe('wizard-wide AbortController', () => {
  beforeEach(() => {
    resetWizardAbortController();
  });

  it('returns a singleton controller across calls', () => {
    const a = getWizardAbortController();
    const b = getWizardAbortController();
    expect(a).toBe(b);
  });

  it('signal is not aborted by default', () => {
    expect(getWizardAbortSignal().aborted).toBe(false);
  });

  it('abortWizard aborts the signal with the provided reason', () => {
    const signal = getWizardAbortSignal();
    abortWizard('user cancelled');
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe('user cancelled');
  });

  it('abortWizard is idempotent — second call does not change the reason', () => {
    abortWizard('first');
    const signalAfterFirst = getWizardAbortSignal();
    abortWizard('second');
    expect(signalAfterFirst.aborted).toBe(true);
    // First reason wins; second call is a no-op.
    expect(signalAfterFirst.reason).toBe('first');
  });

  it('propagates abort to listeners attached via addEventListener', () => {
    const signal = getWizardAbortSignal();
    let fired = false;
    signal.addEventListener('abort', () => {
      fired = true;
    });
    abortWizard('cleanup');
    expect(fired).toBe(true);
  });

  it('resetWizardAbortController gives a fresh, non-aborted controller', () => {
    abortWizard('first run');
    expect(getWizardAbortSignal().aborted).toBe(true);

    resetWizardAbortController();
    const fresh = getWizardAbortController();
    expect(fresh.signal.aborted).toBe(false);
  });

  it('default reason is "wizard cancelled" when no reason is supplied', () => {
    abortWizard();
    expect(getWizardAbortSignal().reason).toBe('wizard cancelled');
  });
});
