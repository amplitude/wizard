/**
 * Verifies the AbortSignal chaining pattern used in agent-interface.ts:
 * the per-attempt AbortController forwards aborts from the wizard-wide
 * signal so a top-level cancel tears down the in-flight SDK query.
 *
 * Pattern under test (mirrors src/lib/agent-interface.ts):
 *   const controller = new AbortController();
 *   const onWizardAbort = () => controller.abort(reason);
 *   wizardSignal.addEventListener('abort', onWizardAbort, { once: true });
 *   // ... attempt runs ...
 *   wizardSignal.removeEventListener('abort', onWizardAbort);
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  abortWizard,
  getWizardAbortSignal,
  resetWizardAbortController,
} from '../../utils/wizard-abort';

function chainController(wizardSignal: AbortSignal): {
  controller: AbortController;
  detach: () => void;
} {
  const controller = new AbortController();
  const onWizardAbort = (): void => {
    if (!controller.signal.aborted) {
      controller.abort(wizardSignal.reason ?? 'wizard cancelled');
    }
  };
  if (wizardSignal.aborted) {
    onWizardAbort();
  } else {
    wizardSignal.addEventListener('abort', onWizardAbort, { once: true });
  }
  return {
    controller,
    detach: () => wizardSignal.removeEventListener('abort', onWizardAbort),
  };
}

describe('agent SDK abort signal chaining', () => {
  beforeEach(() => {
    resetWizardAbortController();
  });

  it('aborts the per-attempt controller when the wizard signal aborts', () => {
    const wizardSignal = getWizardAbortSignal();
    const { controller } = chainController(wizardSignal);

    expect(controller.signal.aborted).toBe(false);

    abortWizard('user cancelled');

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe('user cancelled');
  });

  it('immediately aborts a fresh per-attempt controller if the wizard signal is already aborted', () => {
    abortWizard('cancelled before attempt');
    const wizardSignal = getWizardAbortSignal();
    const { controller } = chainController(wizardSignal);

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe('cancelled before attempt');
  });

  it('detach() removes the listener so subsequent wizard abort does not affect a finished attempt', () => {
    const wizardSignal = getWizardAbortSignal();
    const { controller, detach } = chainController(wizardSignal);

    // Attempt finishes cleanly — listener is removed.
    detach();
    expect(controller.signal.aborted).toBe(false);

    // Wizard later aborts (unrelated to this attempt). The detached
    // controller should NOT be marked aborted because we cleaned up.
    abortWizard('later cancel');
    expect(controller.signal.aborted).toBe(false);
  });

  it('per-attempt controller can still abort independently (e.g. stall) without aborting the wizard signal', () => {
    const wizardSignal = getWizardAbortSignal();
    const { controller } = chainController(wizardSignal);

    controller.abort('stall');

    expect(controller.signal.aborted).toBe(true);
    expect(wizardSignal.aborted).toBe(false);
  });

  it('does not double-abort the per-attempt controller if it was already aborted by stall', () => {
    const wizardSignal = getWizardAbortSignal();
    const { controller } = chainController(wizardSignal);

    controller.abort('stall');
    const reasonAfterStall = controller.signal.reason;

    abortWizard('user cancelled');

    expect(controller.signal.aborted).toBe(true);
    // First reason wins per AbortController semantics.
    expect(controller.signal.reason).toBe(reasonAfterStall);
  });
});
