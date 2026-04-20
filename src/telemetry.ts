import { analytics } from './utils/analytics';

export function traceStep<T>(step: string, callback: () => T): T {
  updateProgress(step);
  return callback();
}

export function updateProgress(step: string) {
  // Track progress as a session property so it reflects the current step
  // on all subsequent events (useful for debugging which step errored).
  analytics.setSessionProperty('progress', step);
}
