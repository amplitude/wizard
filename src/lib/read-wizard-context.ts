/**
 * Reads `<installDir>/.amplitude/wizard-context.json` — optional hints for the
 * wizard-proxy dashboard RPC so request bodies match SDK reality.
 */

import fs from 'node:fs';

import { z } from 'zod';

import { logToFile } from '../utils/debug.js';
import { getWizardContextFile } from '../utils/storage-paths.js';

const WizardContextFileSchema = z.object({
  autocaptureEnabled: z.boolean().optional(),
  productDisplayName: z.string().min(1).max(255).optional(),
  sdkVersion: z.string().min(1).max(64).optional(),
});

export type WizardContextFromDisk = z.infer<typeof WizardContextFileSchema>;

export function readWizardContext(
  installDir: string,
): WizardContextFromDisk | null {
  const filePath = getWizardContextFile(installDir);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const parsed = WizardContextFileSchema.safeParse(raw);
    if (!parsed.success) {
      logToFile(
        `[readWizardContext] invalid ${filePath}: ${parsed.error.message}`,
      );
      return null;
    }
    return parsed.data;
  } catch (err) {
    logToFile(
      `[readWizardContext] ${filePath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}
