/**
 * Wipe pre-existing per-project state that is keyed by install directory.
 *
 * Called on successful direct signup, immediately before the new account's
 * tokens are persisted via `replaceStoredUser`. Without this, a new account
 * created in a directory that previously hosted another account would
 * inherit the prior account's API key (keychain / .env.local), workspace
 * binding (project ampli.json), and resumable session state (checkpoint) —
 * causing the new project to silently route events into the old tenancy.
 *
 * Mirrors the wipe pattern in LogoutScreen so the two "this directory is
 * about to belong to a different account" entry points stay symmetric. The
 * `~/.ampli.json` User-* wipe lives in `replaceStoredUser` (atomic
 * wipe-then-write); this helper covers the install-dir-keyed surfaces it
 * doesn't touch.
 *
 * Each underlying helper is safe to call when no prior state exists.
 */

import { clearApiKey } from './api-key-store.js';
import { clearCheckpoint } from '../lib/session-checkpoint.js';
import { clearAuthFieldsInAmpliConfig } from '../lib/ampli-config.js';

export function clearStaleProjectState(
  installDir: string,
  checkpointReason: 'success' | 'manual' | 'logout' = 'success',
): void {
  clearApiKey(installDir);
  clearCheckpoint(installDir, checkpointReason);
  clearAuthFieldsInAmpliConfig(installDir);
}
