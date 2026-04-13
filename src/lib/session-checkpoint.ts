/**
 * Session checkpointing — persist enough wizard state to resume after a crash.
 *
 * Saves a sanitized snapshot (no credentials/tokens) to a temp file.
 * On restart the wizard can load it to skip already-completed setup steps
 * (intro, region, auth selections) while still re-running the agent.
 */

import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { z } from 'zod';

import type { WizardSession } from './wizard-session';

// ── Constants ──────────────────────────────────────────────────────────

const CHECKPOINT_FILE = join(tmpdir(), 'amplitude-wizard-checkpoint.json');

/** Checkpoints older than 24 hours are considered stale. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// ── Schema ─────────────────────────────────────────────────────────────

const CheckpointSchema = z.object({
  /** ISO-8601 timestamp of when the checkpoint was written. */
  savedAt: z.string(),

  /** The project directory this checkpoint belongs to. */
  installDir: z.string(),

  // Region + org/workspace/project selection
  region: z.enum(['us', 'eu']).nullable(),
  selectedOrgId: z.string().nullable(),
  selectedOrgName: z.string().nullable(),
  selectedWorkspaceId: z.string().nullable(),
  selectedWorkspaceName: z.string().nullable(),
  selectedProjectName: z.string().nullable(),

  // Framework detection
  integration: z.string().nullable(),
  detectedFrameworkLabel: z.string().nullable(),
  detectionComplete: z.boolean(),
  frameworkContext: z.record(z.string(), z.unknown()),

  // Intro
  introConcluded: z.boolean(),
});

type Checkpoint = z.infer<typeof CheckpointSchema>;

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Write a sanitized session snapshot to disk.
 * Strips credentials and any fields that should be re-evaluated on resume.
 */
export function saveCheckpoint(session: WizardSession): void {
  const checkpoint: Checkpoint = {
    savedAt: new Date().toISOString(),
    installDir: session.installDir,

    region: session.region,
    selectedOrgId: session.selectedOrgId,
    selectedOrgName: session.selectedOrgName,
    selectedWorkspaceId: session.selectedWorkspaceId,
    selectedWorkspaceName: session.selectedWorkspaceName,
    selectedProjectName: session.selectedProjectName,

    integration: session.integration,
    detectedFrameworkLabel: session.detectedFrameworkLabel,
    detectionComplete: session.detectionComplete,
    frameworkContext: session.frameworkContext,

    introConcluded: session.introConcluded,
  };

  writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2), {
    mode: 0o600,
  });
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
export function loadCheckpoint(
  installDir: string,
): Partial<WizardSession> | null {
  if (!existsSync(CHECKPOINT_FILE)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(CHECKPOINT_FILE, 'utf-8'));
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

  // Return only the fields that are safe to restore.
  // Credentials, runPhase, activation state, and post-run steps are
  // intentionally omitted so they get re-evaluated on resume.
  return {
    installDir: checkpoint.installDir,
    region: checkpoint.region,
    selectedOrgId: checkpoint.selectedOrgId,
    selectedOrgName: checkpoint.selectedOrgName,
    selectedWorkspaceId: checkpoint.selectedWorkspaceId,
    selectedWorkspaceName: checkpoint.selectedWorkspaceName,
    selectedProjectName: checkpoint.selectedProjectName,
    integration: checkpoint.integration as WizardSession['integration'],
    detectedFrameworkLabel: checkpoint.detectedFrameworkLabel,
    detectionComplete: checkpoint.detectionComplete,
    frameworkContext: checkpoint.frameworkContext,
    introConcluded: checkpoint.introConcluded,
  };
}

/**
 * Delete the checkpoint file. Call on successful wizard completion.
 */
export function clearCheckpoint(): void {
  try {
    if (existsSync(CHECKPOINT_FILE)) {
      unlinkSync(CHECKPOINT_FILE);
    }
  } catch {
    // Best-effort — if deletion fails, the staleness check will expire it.
  }
}
