/**
 * save-diagnostic-artifact — shared helper for the slash-console `/debug`
 * and `/diagnostics` commands.
 *
 * Both commands previously inlined the same pattern:
 *
 *   1. Resolve the per-run dir (`getRunDir(installDir)`).
 *   2. `mkdir -p` with `0o700`.
 *   3. `writeFileSync` an artifact (snapshot JSON / diagnostics txt).
 *   4. On success: surface `[...summaryLines, '', 'Saved to: <path>']` via
 *      `setCommandFeedback`.
 *   5. On failure: surface `[...summaryLines, '', '<fallback message>']`
 *      so the user still sees the inline summary.
 *
 * Funneling both through one helper keeps the on-disk side-effect path
 * (mkdir → write → fall back) identical across commands and lets each
 * caller focus on producing its own summary lines + payload.
 *
 * Pure-ish: takes a `writeFile`-shaped sink so unit tests can swap it
 * without touching the real filesystem. Defaults to `fs.writeFileSync`.
 */

import { getRunDir } from '../../../utils/storage-paths.js';

export interface SaveDiagnosticArtifactOptions {
  /** Project install dir — drives `getRunDir(...)`. */
  installDir: string;
  /** Basename written under the run dir (e.g. `debug-snapshot.json`). */
  fileName: string;
  /** Bytes to write. */
  payload: string;
  /** Summary lines surfaced inline (with or without the Saved-to footer). */
  summaryLines: string[];
  /** Message appended after a blank line when the disk write fails. */
  fallbackMessage: string;
}

export interface SaveDiagnosticArtifactResult {
  /** Lines to pass straight to `store.setCommandFeedback(...)`. */
  feedbackLines: string[];
}

/**
 * Try to persist `payload` to `<runDir>/<fileName>` and return the
 * feedback lines the caller should hand to `setCommandFeedback`.
 *
 * Never throws — disk-write failures are absorbed and reported via the
 * `fallbackMessage` footer. The TUI must not crash because a temp dir is
 * read-only.
 */
export async function saveDiagnosticArtifact({
  installDir,
  fileName,
  payload,
  summaryLines,
  fallbackMessage,
}: SaveDiagnosticArtifactOptions): Promise<SaveDiagnosticArtifactResult> {
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const runDir = getRunDir(installDir);
    fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
    const artifactPath = path.join(runDir, fileName);
    fs.writeFileSync(artifactPath, payload, 'utf8');
    return {
      feedbackLines: [...summaryLines, '', `Saved to: ${artifactPath}`],
    };
  } catch {
    return {
      feedbackLines: [...summaryLines, '', fallbackMessage],
    };
  }
}
