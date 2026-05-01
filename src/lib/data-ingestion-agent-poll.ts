import type { WizardSession } from './wizard-session.js';

/** First inter-poll delay after a poll that found no events (ms). */
export const DATA_INGESTION_POLL_BACKOFF_START_MS = 5_000;

/** Added to the prior delay each cycle until the cap is reached (ms). */
export const DATA_INGESTION_POLL_BACKOFF_STEP_MS = 5_000;

/** Ceiling for inter-poll delay (ms). */
export const DATA_INGESTION_POLL_BACKOFF_CAP_MS = 30_000;

/**
 * Max wall-clock wait for agent-mode ingestion polling.
 *
 * Override with `DATA_INGESTION_TIMEOUT_MS` (milliseconds, positive integer).
 * When unset: CI runs use a shorter ceiling than interactive `--agent` so
 * stuck pipelines fail faster; interactive agent runs keep a moderate budget
 * below the historical 30m default.
 */
export function resolveDataIngestionMaxWaitMs(session: WizardSession): number {
  const fromEnv = Number(process.env.DATA_INGESTION_TIMEOUT_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return fromEnv;
  }
  if (session.ci) {
    return 10 * 60 * 1000;
  }
  return 20 * 60 * 1000;
}

/** Next inter-poll delay after completing a wait of `currentDelayMs`. */
export function nextDataIngestionPollWaitMs(currentDelayMs: number): number {
  return Math.min(
    DATA_INGESTION_POLL_BACKOFF_CAP_MS,
    currentDelayMs + DATA_INGESTION_POLL_BACKOFF_STEP_MS,
  );
}
