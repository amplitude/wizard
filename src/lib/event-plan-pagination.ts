/**
 * event-plan-pagination — pure helpers for splitting a confirmed event plan
 * into chunks the agent can instrument under fresh context per chunk.
 *
 * Background: SCALE_RESEARCH.md §C.2 + LLM_RELIABILITY_RESEARCH.md §B.2
 * converge on the same recommendation — at ≥50 events the single-batch
 * `confirm_event_plan` flow runs into context-rot (~120 events) and the
 * rich tracking-plan doesn't survive compaction (~200 events). The fix is
 * to chunk the write phase into ~25-event batches with a fresh context
 * per chunk.
 *
 * This module is pure / no I/O: callers (tests, the runner, the
 * wizard-tools server) compose it with persistence and agent invocation.
 */
import { logToFile } from '../utils/debug.js';

/**
 * Minimum number of events at which pagination kicks in. Below this, the
 * single-batch flow is preserved unchanged. The threshold matches the
 * "context-rot floor" estimate from LLM_RELIABILITY_RESEARCH §B.1 (effective
 * attention starts to rot above ~60–80k tokens; 50 events × ~350 tokens
 * each puts the wizard around that boundary including skills + commandments).
 */
export const PAGINATION_THRESHOLD = 50;

/**
 * Default events per batch. Picked from SCALE_RESEARCH §C.2: "instrument
 * events 1-25 → agent runs to completion → runner persists progress →
 * instrument events 26-50". A batch of 25 sits comfortably under 120k
 * tokens of working set even on a heavy framework with full skills loaded.
 */
export const DEFAULT_CHUNK_SIZE = 25;

/**
 * Lower bound on chunk size. Below this each chunk's overhead (system
 * prompt, skill bodies, integration scaffolding) dominates payload, and
 * the wizard does more agent round-trips than it saves on context rot.
 */
export const MIN_CHUNK_SIZE = 5;

/**
 * Upper bound on chunk size. Above this the chunk approaches the
 * single-batch failure mode the pagination is supposed to avoid.
 */
export const MAX_CHUNK_SIZE = 100;

/** Env override for chunk size. Documented in CLAUDE.md. */
const CHUNK_SIZE_ENV = 'AMPLITUDE_WIZARD_EVENT_PLAN_CHUNK_SIZE';

/**
 * Resolve the configured chunk size from the environment, clamped to
 * `[MIN_CHUNK_SIZE, MAX_CHUNK_SIZE]`. Falls back to {@link DEFAULT_CHUNK_SIZE}
 * when unset, non-numeric, ≤0, or out of range. The clamp is silent on the
 * happy path; only out-of-range overrides emit a debug log so a typo doesn't
 * silently get a different value.
 */
export function resolveChunkSize(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[CHUNK_SIZE_ENV];
  if (!raw) return DEFAULT_CHUNK_SIZE;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logToFile(
      `[event-plan-pagination] ${CHUNK_SIZE_ENV}="${raw}" not a positive integer; using default ${DEFAULT_CHUNK_SIZE}`,
    );
    return DEFAULT_CHUNK_SIZE;
  }
  if (parsed < MIN_CHUNK_SIZE || parsed > MAX_CHUNK_SIZE) {
    logToFile(
      `[event-plan-pagination] ${CHUNK_SIZE_ENV}=${parsed} out of range [${MIN_CHUNK_SIZE}, ${MAX_CHUNK_SIZE}]; using default ${DEFAULT_CHUNK_SIZE}`,
    );
    return DEFAULT_CHUNK_SIZE;
  }
  return parsed;
}

/**
 * Return true iff a plan of `eventCount` events should be paginated. Single
 * source of truth so the runner, the tool, and tests all agree.
 */
export function shouldPaginate(eventCount: number): boolean {
  return eventCount > PAGINATION_THRESHOLD;
}

/** A single batch of event indices, indexed against the full plan. */
export interface EventBatch {
  /** 0-indexed batch number. */
  batchIndex: number;
  /** Total batches in the plan (constant across all batches). */
  totalBatches: number;
  /** 0-indexed offsets into the full event array, inclusive of `start`, exclusive of `end`. */
  start: number;
  end: number;
}

/**
 * Split a flat event count into batches of at most `chunkSize` events.
 * Returns `[]` when there are no events. Always returns at least one batch
 * when there is one or more event, even when `eventCount < chunkSize`.
 */
export function buildBatches(
  eventCount: number,
  chunkSize: number = resolveChunkSize(),
): EventBatch[] {
  if (eventCount <= 0) return [];
  const safeChunk = Math.max(1, Math.floor(chunkSize));
  const totalBatches = Math.ceil(eventCount / safeChunk);
  const batches: EventBatch[] = [];
  for (let i = 0; i < totalBatches; i++) {
    const start = i * safeChunk;
    const end = Math.min(start + safeChunk, eventCount);
    batches.push({ batchIndex: i, totalBatches, start, end });
  }
  return batches;
}

/**
 * Validate a (batchIndex, totalBatches) pair against an event count and
 * declared chunk size. Returns an error string if the inputs are mutually
 * inconsistent, or `null` when everything checks out. Used by the
 * `confirm_event_plan` tool to reject malformed batch metadata before any
 * persistence work runs.
 */
export function validateBatchMetadata(input: {
  batchIndex?: number;
  totalBatches?: number;
  chunkSize?: number;
  eventCount: number;
}): string | null {
  const { batchIndex, totalBatches, chunkSize, eventCount } = input;

  // Fully absent — caller is using the legacy single-plan shape. OK.
  if (batchIndex === undefined && totalBatches === undefined) return null;

  // Partially provided — both must be present together.
  if (batchIndex === undefined || totalBatches === undefined) {
    return 'batchIndex and totalBatches must be provided together';
  }

  if (!Number.isInteger(batchIndex) || batchIndex < 0) {
    return `batchIndex must be a non-negative integer (got ${batchIndex})`;
  }
  if (!Number.isInteger(totalBatches) || totalBatches < 1) {
    return `totalBatches must be a positive integer (got ${totalBatches})`;
  }
  if (batchIndex >= totalBatches) {
    return `batchIndex (${batchIndex}) must be < totalBatches (${totalBatches})`;
  }
  if (eventCount <= 0) {
    return 'events array must be non-empty when batch metadata is provided';
  }

  if (chunkSize !== undefined) {
    if (!Number.isInteger(chunkSize) || chunkSize < MIN_CHUNK_SIZE) {
      return `chunkSize must be ≥ ${MIN_CHUNK_SIZE} (got ${chunkSize})`;
    }
    if (chunkSize > MAX_CHUNK_SIZE) {
      return `chunkSize must be ≤ ${MAX_CHUNK_SIZE} (got ${chunkSize})`;
    }
  }

  return null;
}
