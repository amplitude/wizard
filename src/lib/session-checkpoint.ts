/**
 * Session checkpointing — persist enough wizard state to resume after a crash.
 *
 * Saves a sanitized snapshot (no credentials/tokens) to a temp file.
 * On restart the wizard can load it to skip already-completed setup steps
 * (intro, region, auth selections) while still re-running the agent.
 */

import { readFileSync, unlinkSync, existsSync } from 'fs';
import { atomicWriteJSON } from '../utils/atomic-write.js';
import {
  ensureDir,
  getCheckpointFile,
  getRunDir,
} from '../utils/storage-paths.js';
import { z } from 'zod';

import type { WizardSession } from './wizard-session';
import { Integration } from './constants.js';
import { getUI } from '../ui';

// ── Constants ──────────────────────────────────────────────────────────

/** Per-project checkpoint file using a hash of installDir to avoid cross-instance clobbering. */
function checkpointPath(installDir: string): string {
  const dir = installDir || process.cwd();
  return getCheckpointFile(dir);
}

/** Checkpoints older than 24 hours are considered stale. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// ── Schema ─────────────────────────────────────────────────────────────

const CheckpointSchema = z
  .object({
    /** ISO-8601 timestamp of when the checkpoint was written. */
    savedAt: z.string(),

    /** The project directory this checkpoint belongs to. */
    installDir: z.string(),

    // Region + org/project/environment selection
    region: z.enum(['us', 'eu']).nullable(),
    selectedOrgId: z.string().nullable(),
    selectedOrgName: z.string().nullable(),
    // New (post-rename) fields.
    selectedProjectId: z.string().nullable().optional(),
    selectedProjectName: z.string().nullable().optional(),
    selectedEnvName: z.string().nullable().optional(),
    // Legacy fields kept for back-compat reads.
    // - selectedWorkspaceId/Name: renamed to selectedProjectId/Name when
    //   the codebase adopted the website's "project" terminology. Empty /
    //   whitespace-only ids from old checkpoints are coerced to null at
    //   read time in loadCheckpoint().
    selectedWorkspaceId: z.string().nullable().optional(),
    selectedWorkspaceName: z.string().nullable().optional(),

    // Framework detection
    integration: z.string().nullable(),
    detectedFrameworkLabel: z.string().nullable(),
    detectionComplete: z.boolean(),
    frameworkContext: z.record(z.string(), z.unknown()),
    frameworkContextAnswerOrder: z.array(z.string()).optional(),

    // Intro
    introConcluded: z.boolean(),
  })
  .transform((data) => {
    const {
      selectedWorkspaceId,
      selectedWorkspaceName,
      selectedProjectId,
      selectedProjectName,
      ...rest
    } = data;
    return {
      ...rest,
      selectedProjectId: selectedProjectId ?? selectedWorkspaceId ?? null,
      selectedProjectName: selectedProjectName ?? selectedWorkspaceName ?? null,
      // selectedEnvName has no semantic relationship to selectedProjectName
      // — falling back from one to the other would silently use the project
      // name as the environment name in HeaderBar / `/whoami`, and break
      // any code path that filters environments by name.
      selectedEnvName: rest.selectedEnvName ?? null,
    };
  });

type Checkpoint = z.infer<typeof CheckpointSchema>;

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Write a sanitized session snapshot to disk.
 * Strips credentials and any fields that should be re-evaluated on resume.
 *
 * `phase` is a free-form trigger label ("pre_compact",
 * "screen_run", "screen_data_setup", etc.) — emitted on the NDJSON
 * stream in agent mode so an orchestrator can distinguish "we hit a
 * checkpoint inside the integration loop" from "the agent just blew
 * through a phase boundary". Defaults to `"unknown"` for legacy
 * callers that haven't been updated yet.
 */
export function saveCheckpoint(
  session: WizardSession,
  phase: string = 'unknown',
): void {
  const checkpoint: Checkpoint = {
    savedAt: new Date().toISOString(),
    installDir: session.installDir,

    region: session.region,
    selectedOrgId: session.selectedOrgId,
    selectedOrgName: session.selectedOrgName,
    selectedProjectId: session.selectedProjectId,
    selectedProjectName: session.selectedProjectName,
    selectedEnvName: session.selectedEnvName,

    integration: session.integration,
    detectedFrameworkLabel: session.detectedFrameworkLabel,
    detectionComplete: session.detectionComplete,
    frameworkContext: session.frameworkContext,
    frameworkContextAnswerOrder: session.frameworkContextAnswerOrder,

    introConcluded: session.introConcluded,
  };

  // Ensure the per-project run dir exists; cache root may not have been created yet.
  ensureDir(getRunDir(session.installDir));
  const filePath = checkpointPath(session.installDir);
  atomicWriteJSON(filePath, checkpoint, 0o600);

  // Surface the write to AgentUI so an orchestrator knows there's a
  // recoverable state on disk for `--resume`. Wrapped in try/catch
  // because the UI emit must never disturb the actual checkpoint
  // write (a thrown emitter would leave the user without crash
  // recovery — strictly worse than a silent telemetry drop).
  try {
    // Match the on-disk format `atomicWriteJSON` actually writes:
    // `JSON.stringify(data, null, 2) + '\n'`. The previous compact-form
    // computation under-reported by 2-3× because pretty-print + trailing
    // newline expand the file substantially — orchestrators reading
    // `bytes` for cost or policy would see a misleadingly small number.
    const bytes = Buffer.byteLength(
      JSON.stringify(checkpoint, null, 2) + '\n',
      'utf8',
    );
    getUI().emitCheckpointSaved?.({ path: filePath, bytes, phase });
  } catch {
    /* checkpoint persistence wins over telemetry */
  }
}

/**
 * Load a checkpoint if one exists, is fresh, and matches the given install dir.
 *
 * Returns a partial session (only the checkpointed fields) or null when:
 * - no checkpoint file exists
 * - the checkpoint is older than 24 hours
 * - the checkpoint belongs to a different project directory
 * - the file is malformed or fails validation
 */
export async function loadCheckpoint(
  installDir: string,
): Promise<Partial<WizardSession> | null> {
  const filePath = checkpointPath(installDir);
  if (!existsSync(filePath)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }

  const result = CheckpointSchema.safeParse(raw);
  if (!result.success) return null;

  const checkpoint = result.data;

  // Stale check
  const age = Date.now() - new Date(checkpoint.savedAt).getTime();
  if (age > MAX_AGE_MS) return null;

  // Must match the current project directory
  if (checkpoint.installDir !== installDir) return null;

  // Self-heal: if integration is a known framework, derive the display
  // label from the registry instead of trusting the persisted value.
  // Older builds could write a stale "Generic" label alongside a valid
  // integration when detection auto-fell-back; re-deriving keeps the UI
  // consistent with the actual framework config.
  const integration = checkpoint.integration as WizardSession['integration'];
  const derivedLabel = await deriveFrameworkLabel(
    integration,
    checkpoint.detectedFrameworkLabel,
  );

  // Surface the load to AgentUI so an orchestrator can confirm the
  // resumed state is the one it expected (and refuse to keep going if
  // the checkpoint is older than its policy allows). Wrapped in
  // try/catch — telemetry must not block restoration.
  try {
    const ageSeconds = Math.round(age / 1000);
    getUI().emitCheckpointLoaded?.({ path: filePath, ageSeconds });
  } catch {
    /* restore must not be blocked by a UI emit */
  }

  // Return only the fields that are safe to restore.
  // Credentials, runPhase, activation state, and post-run steps are
  // intentionally omitted so they get re-evaluated on resume.
  return {
    installDir: checkpoint.installDir,
    region: checkpoint.region,
    selectedOrgId: checkpoint.selectedOrgId,
    selectedOrgName: checkpoint.selectedOrgName,
    // The schema transform has already collapsed legacy
    // `selectedWorkspaceId/Name` checkpoints into the post-rename
    // `selectedProjectId/Name` fields. Coerce empty / whitespace-only IDs
    // (which older checkpoints could carry) to null so callers can rely
    // on truthy checks.
    selectedProjectId:
      checkpoint.selectedProjectId &&
      checkpoint.selectedProjectId.trim().length > 0
        ? checkpoint.selectedProjectId
        : null,
    selectedProjectName: checkpoint.selectedProjectName ?? null,
    selectedEnvName: checkpoint.selectedEnvName,
    integration,
    detectedFrameworkLabel: derivedLabel,
    detectionComplete: checkpoint.detectionComplete,
    frameworkContext: checkpoint.frameworkContext,
    frameworkContextAnswerOrder: checkpoint.frameworkContextAnswerOrder ?? [],
    introConcluded: checkpoint.introConcluded,
  };
}

/**
 * Derive the display label for a persisted integration. If the integration
 * matches a known framework, trust the registry's name over the persisted
 * label (handles corrupted checkpoints from older builds). Falls back to
 * the persisted label only when the integration isn't recognized.
 *
 * Generic is intentionally excluded: when the wizard falls back to Generic,
 * `detectedFrameworkLabel` is left `null` on purpose and must stay `null`
 * across checkpoint save/restore.
 *
 * The registry is loaded dynamically to avoid eagerly pulling in all 18
 * framework modules on the critical startup path.
 */
async function deriveFrameworkLabel(
  integration: WizardSession['integration'],
  persistedLabel: string | null,
): Promise<string | null> {
  if (!integration) return persistedLabel;
  if (integration === Integration.generic) return persistedLabel;
  const known = Object.values(Integration).includes(integration);
  if (!known) return persistedLabel;
  const { FRAMEWORK_REGISTRY } = await import('./registry.js');
  return FRAMEWORK_REGISTRY[integration].metadata.name;
}

/**
 * Delete the checkpoint file. Call on successful wizard completion.
 *
 * `reason` is a discriminator for the structured NDJSON event:
 *   - `success` — clean run, the wizard finished
 *   - `manual`  — user invoked a clear-state action (e.g. resetting
 *                 from the IntroScreen "start fresh" button)
 *   - `logout`  — the auth flow was reset; checkpoint is no longer
 *                 attributable to the current account
 *
 * Defaults to `success` to keep legacy callers working.
 */
export function clearCheckpoint(
  installDir: string,
  reason: 'success' | 'manual' | 'logout' = 'success',
): void {
  const filePath = checkpointPath(installDir);
  let removed = false;
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
      removed = true;
    }
  } catch {
    // Best-effort — if deletion fails, the staleness check will expire it.
  }

  if (removed) {
    try {
      getUI().emitCheckpointCleared?.({ path: filePath, reason });
    } catch {
      /* clear must not be blocked by a UI emit */
    }
  }
}
