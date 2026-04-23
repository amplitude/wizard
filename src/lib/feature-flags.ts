/**
 * Feature flags powered by Amplitude Experiment (server-side local evaluation).
 *
 * Flags are fetched once at startup via `initFeatureFlags()` and evaluated
 * synchronously thereafter — no per-check network calls.
 */

import { Experiment } from '@amplitude/experiment-node-server';
import type { LocalEvaluationClient } from '@amplitude/experiment-node-server';
import { debug } from '../utils/debug';

// ── Flag keys ────────────────────────────────────────────────────────

/** Gate for the LLM analytics additional-feature flow. */
export const FLAG_LLM_ANALYTICS = 'wizard-llm-analytics';

/** Gate for agent-level analytics / telemetry instrumented by the wizard. */
export const FLAG_AGENT_ANALYTICS = 'wizard-agent-analytics';

// ── Deployment key ───────────────────────────────────────────────────

/**
 * Server deployment key for local evaluation.
 * Override with `AMPLITUDE_EXPERIMENT_DEPLOYMENT_KEY` env var.
 */
const DEFAULT_DEPLOYMENT_KEY = 'server-YOTsk4MS1RWzLyIf1DmvNDUsdOGqkRdM';

function resolveDeploymentKey(): string {
  const fromEnv = process.env.AMPLITUDE_EXPERIMENT_DEPLOYMENT_KEY;
  return (fromEnv ?? DEFAULT_DEPLOYMENT_KEY).trim();
}

// ── Singleton client ─────────────────────────────────────────────────

let client: LocalEvaluationClient | null = null;
let cachedFlags: Record<string, string> = {};

/**
 * Initialize the Experiment local-evaluation client and pre-fetch flag configs.
 * Safe to call multiple times — subsequent calls are no-ops.
 *
 * @param userId  Optional user ID for targeted flag evaluation.
 * @param deviceId  Optional device ID for targeted flag evaluation.
 */
export async function initFeatureFlags(
  userId?: string,
  deviceId?: string,
): Promise<void> {
  if (client) return; // already initialized

  const deploymentKey = resolveDeploymentKey();
  if (!deploymentKey) {
    debug('feature-flags: no deployment key — all flags default to off');
    return;
  }

  try {
    client = Experiment.initializeLocal(deploymentKey);
    await client.start();

    const user: Record<string, string> = {};
    if (userId) user.user_id = userId;
    if (deviceId) user.device_id = deviceId;

    const variants = client.evaluateV2(user);
    for (const [key, variant] of Object.entries(variants)) {
      if (variant.value !== undefined && variant.value !== null) {
        cachedFlags[key] = String(variant.value);
      }
    }

    debug('feature-flags: initialized with flags', cachedFlags);
  } catch (err) {
    debug(
      'feature-flags: initialization failed, defaulting all flags off',
      err,
    );
    client = null;
  }
}

/**
 * Evaluate a single feature flag. Returns the string variant value,
 * or `undefined` if the flag is not set / client not initialized.
 */
export function getFlag(flagKey: string): string | undefined {
  return cachedFlags[flagKey];
}

/**
 * Check whether a flag is enabled (variant is `'on'` or `'true'`).
 * Returns `false` when the flag is absent or the client is not initialized.
 */
export function isFlagEnabled(flagKey: string): boolean {
  const value = cachedFlags[flagKey];
  return value === 'on' || value === 'true';
}

/**
 * Return a snapshot of all evaluated flags (key -> string value).
 */
export function getAllFlags(): Record<string, string> {
  return { ...cachedFlags };
}

/**
 * Re-evaluate flags for a specific user (e.g. after login).
 * Updates the cached flags in place.
 */
export async function refreshFlags(
  userId?: string,
  deviceId?: string,
): Promise<void> {
  if (!client) return;

  try {
    // Re-fetch flag configs in case they changed
    await client.start();

    const user: Record<string, string> = {};
    if (userId) user.user_id = userId;
    if (deviceId) user.device_id = deviceId;

    const variants = client.evaluateV2(user);
    cachedFlags = {};
    for (const [key, variant] of Object.entries(variants)) {
      if (variant.value !== undefined && variant.value !== null) {
        cachedFlags[key] = String(variant.value);
      }
    }

    debug('feature-flags: refreshed flags', cachedFlags);
  } catch (err) {
    debug('feature-flags: refresh failed', err);
  }
}
