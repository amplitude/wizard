/**
 * Persistent install UUID for cross-session analytics correlation.
 *
 * Stored at ~/.amplitude-wizard/install.json. Used as Amplitude `device_id`
 * so pre-auth runs from the same install are stitched to the authenticated
 * identity once `identifyUser()` fires. Without this, every CLI invocation
 * is a fresh anonymous user until auth completes.
 *
 * IO failures are non-fatal: the caller falls back to a per-process UUID.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { atomicWriteJSON } from './atomic-write.js';
import { debug } from './debug.js';

export const INSTALL_DIR = path.join(os.homedir(), '.amplitude-wizard');
export const INSTALL_FILE = path.join(INSTALL_DIR, 'install.json');

const InstallRecordSchema = z.object({
  installId: z.string().uuid(),
  createdAt: z.string(),
});

type InstallRecord = z.infer<typeof InstallRecordSchema>;

function readInstallRecord(filePath: string): InstallRecord | undefined {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = InstallRecordSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function writeInstallRecord(filePath: string, record: InstallRecord): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  atomicWriteJSON(filePath, record, 0o600);
}

/**
 * Load the persisted install UUID, or create and persist a new one.
 * Returns the UUID on success, or `undefined` if both read and write fail
 * (caller should fall back to a per-process UUID).
 */
export function getOrCreateInstallId(
  filePath = INSTALL_FILE,
): string | undefined {
  const existing = readInstallRecord(filePath);
  if (existing) {
    return existing.installId;
  }

  const record: InstallRecord = {
    installId: uuidv4(),
    createdAt: new Date().toISOString(),
  };

  try {
    writeInstallRecord(filePath, record);
    return record.installId;
  } catch (err) {
    debug('install-id: failed to persist', err);
    return undefined;
  }
}
