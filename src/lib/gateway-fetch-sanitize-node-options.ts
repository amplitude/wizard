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
 *
 * We intentionally only resolve the bootstrap relative to this module
 * (`__dirname`) — never relative to `process.cwd()`. The cwd is the user's
 * project directory, so a cwd-relative fallback would let a file at
 * `<user-project>/dist/src/lib/register-gateway-fetch-sanitize-bootstrap.js`
 * be `--require`'d into the agent subprocess. If the bootstrap is missing
 * next to this module, return `undefined` so the SDK runs without the patch
 * rather than loading code from an untrusted location.
 */
export function buildGatewaySanitizeNodeOptions(
  existingNodeOptions: string | undefined,
): string | undefined {
  const besideThisModule = resolveRegisterGatewayFetchSanitizePath();
  if (!fs.existsSync(besideThisModule)) {
    return undefined;
  }
  const append = `--require ${JSON.stringify(besideThisModule)}`;
  return mergeNodeOptions(existingNodeOptions, append);
}
