import { analytics } from './utils/analytics';
import { withWizardSpan, addBreadcrumb } from './lib/observability';

/**
 * Run a wizard step inside a Sentry span and update the analytics
 * 'progress' session property.
 *
 * The session property tags every subsequent analytics event with the
 * current step (handy for diagnosing where a session errored). The Sentry
 * span gives the step its own row in the perf waterfall, captures any
 * thrown error with the step name in scope, and auto-instruments outbound
 * HTTP via the default Sentry httpIntegration.
 *
 * Works for both sync and async callbacks. No-ops on the Sentry side when
 * telemetry is disabled.
 */
export function traceStep<T>(step: string, callback: () => T): T {
  updateProgress(step);
  addBreadcrumb('step', `Step started: ${step}`);
  return withWizardSpan(`step.${step}`, 'wizard.step', { step }, callback);
}

export function updateProgress(step: string) {
  // Track progress as a session property so it reflects the current step
  // on all subsequent events (useful for debugging which step errored).
  analytics.setSessionProperty('progress', step);
}
