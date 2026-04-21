/**
 * Diagnostic bundle uploader for PR 3.1 (observability spine).
 *
 * Posts a gzipped bundle to the wizard-proxy `/diagnostics` endpoint. The
 * backend lands separately; until then we degrade gracefully:
 *   - On 404/501 the bundle is written to `/tmp/amplitude-wizard-diagnostic-<runId>.gz`
 *     and the local path is returned to the caller.
 *   - On DO_NOT_TRACK (or the wizard-specific opt-out) the upload is refused
 *     with a clear reason string.
 */

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import axios from 'axios';
import { z } from 'zod';
import { getWizardProxyBase } from './api';
import { createTracingHeaders } from '../utils/custom-headers';
import { WIZARD_USER_AGENT, type AmplitudeZone } from './constants';
import { logToFile } from '../utils/debug';
import type { DiagnosticBundle } from './diagnostic-bundle';

export interface UploadOptions {
  zone: AmplitudeZone;
  /** OAuth access token for authenticated upload. Optional — unauth uploads also accepted. */
  accessToken?: string;
}

export type UploadResult =
  | { kind: 'uploaded'; url: string; id: string }
  | { kind: 'local'; path: string; reason: 'backend-missing' | 'upload-failed' }
  | { kind: 'skipped'; reason: 'telemetry-disabled' };

function telemetryDisabled(): boolean {
  return (
    process.env.DO_NOT_TRACK === '1' ||
    process.env.AMPLITUDE_WIZARD_NO_TELEMETRY === '1'
  );
}

/** Fallback — write the bundle to a tempdir and return the path. */
function writeLocalBundle(bundle: DiagnosticBundle): string {
  const filename = `amplitude-wizard-diagnostic-${bundle.meta.runId}.gz`;
  const path = join(tmpdir(), filename);
  writeFileSync(path, bundle.bytes, { mode: 0o600 });
  logToFile(`[diagnostic-upload] wrote local bundle ${path}`);
  return path;
}

/**
 * Attempt to upload the bundle. Honors DO_NOT_TRACK; never throws.
 */
export async function uploadBundle(
  bundle: DiagnosticBundle,
  opts: UploadOptions,
): Promise<UploadResult> {
  if (telemetryDisabled()) {
    logToFile('[diagnostic-upload] telemetry disabled — skipping upload');
    return { kind: 'skipped', reason: 'telemetry-disabled' };
  }

  const url = `${getWizardProxyBase(opts.zone)}/diagnostics`;
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/gzip',
      'Content-Encoding': 'gzip',
      'User-Agent': WIZARD_USER_AGENT,
      ...createTracingHeaders(),
      'X-Wizard-Diagnostic-Run-Id': bundle.meta.runId,
    };
    if (opts.accessToken) {
      headers.Authorization = `Bearer ${opts.accessToken}`;
    }

    const response = await axios.post(url, bundle.bytes, {
      headers,
      validateStatus: () => true,
      timeout: 20_000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    if (response.status === 404 || response.status === 501) {
      const path = writeLocalBundle(bundle);
      return { kind: 'local', path, reason: 'backend-missing' };
    }

    if (response.status >= 200 && response.status < 300) {
      const parsed = z
        .object({ url: z.string(), id: z.string() })
        .safeParse(response.data);
      if (parsed.success) {
        return { kind: 'uploaded', url: parsed.data.url, id: parsed.data.id };
      }
      // Success but unexpected payload — still better to return a local copy
      // so the user can share something concrete.
      const path = writeLocalBundle(bundle);
      return { kind: 'local', path, reason: 'upload-failed' };
    }

    logToFile(
      `[diagnostic-upload] non-2xx response ${response.status}`,
      typeof response.data === 'string'
        ? response.data.slice(0, 200)
        : undefined,
    );
    const path = writeLocalBundle(bundle);
    return { kind: 'local', path, reason: 'upload-failed' };
  } catch (err) {
    logToFile(
      `[diagnostic-upload] upload failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    const path = writeLocalBundle(bundle);
    return { kind: 'local', path, reason: 'upload-failed' };
  }
}
