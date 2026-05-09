/**
 * Orchestration store file location.
 *
 * Lives co-located under the existing per-project run dir
 * (`<cacheRoot>/runs/<sha256(installDir)>/orchestration.json`) so:
 *
 *   - Two parallel wizard runs in different install dirs don't collide on a
 *     shared store file (the per-run dir already gives us that scoping).
 *   - The orchestration file is gathered automatically by support-bundle
 *     tooling that already grabs `runs/<hash>/`.
 *   - A single `rm -rf <runDir>` blows away every wizard side-effect for that
 *     install dir, including orchestration state.
 *
 * Single store per install dir: matches the existing "single active wizard
 * per install dir" assumption that `apply.lock` already enforces. We don't
 * need cross-process coordination beyond "atomic write + last-writer-wins"
 * because there is at most one writer.
 */
import { join } from 'node:path';
import { getRunDir } from '../../utils/storage-paths';

/** Per-project orchestration store file. */
export function getOrchestrationStoreFile(installDir: string): string {
  return join(getRunDir(installDir), 'orchestration.json');
}
