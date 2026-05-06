/**
 * Build `NODE_OPTIONS` for the Claude Agent SDK subprocess so it preloads
 * {@link ./register-gateway-fetch-sanitize-bootstrap.js}, which patches `globalThis.fetch`
 * for `/v1/messages` requests (Vertex-compatible JSON schema sanitization).
 */

import fs from 'fs';
import path from 'path';

/** Merge NODE_OPTIONS fragments without duplicating spaces. */
export function mergeNodeOptions(
  existing: string | undefined,
  append: string,
): string {
  const parts = [existing?.trim(), append.trim()].filter(
    (p): p is string => !!p && p.length > 0,
  );
  return parts.join(' ').replace(/\s+/g, ' ');
}

/** Absolute path to the compiled `--require` bootstrap (same dir as this file). */
export function resolveRegisterGatewayFetchSanitizePath(): string {
  return path.join(__dirname, 'register-gateway-fetch-sanitize-bootstrap.js');
}

/**
 * Returns updated NODE_OPTIONS including `--require <register>` when the
 * register script exists next to this module in `dist/`.
 */
export function buildGatewaySanitizeNodeOptions(
  existingNodeOptions: string | undefined,
): string | undefined {
  const besideThisModule = resolveRegisterGatewayFetchSanitizePath();
  const fromDistRoot = path.join(
    process.cwd(),
    'dist/src/lib/register-gateway-fetch-sanitize-bootstrap.js',
  );
  const scriptPath = fs.existsSync(besideThisModule)
    ? besideThisModule
    : fs.existsSync(fromDistRoot)
    ? fromDistRoot
    : undefined;
  if (!scriptPath) {
    return undefined;
  }
  const append = `--require ${JSON.stringify(scriptPath)}`;
  return mergeNodeOptions(existingNodeOptions, append);
}
