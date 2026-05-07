#!/usr/bin/env node
// Refresh a long-lived Amplitude OAuth refresh token into a fresh access
// token, then write the new credential triple to GITHUB_OUTPUT so a
// scheduled GitHub Actions workflow can rotate the corresponding repo
// secrets (WIZARD_OAUTH_TOKEN / WIZARD_REFRESH_TOKEN / WIZARD_EXPIRES_AT).
//
// Mirrors the silent-refresh logic in src/utils/token-refresh.ts but
// without any wizard runtime dependencies — runs on a clean Node 20+
// install with built-in `fetch` only.
//
// Reads:
//   WIZARD_REFRESH_TOKEN  required — the current refresh token
//   WIZARD_ZONE           optional — 'us' (default) or 'eu'
//   GITHUB_OUTPUT         optional — file to append outputs to (set by GHA)
//
// Outputs (to GITHUB_OUTPUT, one per line as `key=value`):
//   refresh        'ok' on success, 'failed' on failure
//   access_token   new access token (success only)
//   refresh_token  rotated refresh token, or echoed input if unrotated (success only)
//   expires_at     ISO 8601 expiry timestamp (success only)
//
// Exit codes:
//   0 — refresh succeeded
//   1 — missing input or refresh failed (refresh=failed already written)

import { appendFileSync } from 'node:fs';

// Mirror of AMPLITUDE_ZONE_SETTINGS in src/lib/constants.ts. Kept inline
// (not imported) so the workflow doesn't require `pnpm install` before
// running — keeps the rotation step robust against transient registry
// flakes. Update both in lock-step when zone settings change.
const ZONE_SETTINGS = {
  us: {
    oAuthHost: 'https://auth.amplitude.com',
    oAuthClientId: '0ac84169-c41c-4222-885b-31469c761cb0',
  },
  eu: {
    oAuthHost: 'https://auth.eu.amplitude.com',
    oAuthClientId: '110d04a1-8e60-4157-9c43-fcbe4e014a85',
  },
};

const REQUEST_TIMEOUT_MS = 10_000;

function fail(message) {
  process.stderr.write(`refresh-wizard-oauth-token: ${message}\n`);
  writeOutput({ refresh: 'failed' });
  process.exit(1);
}

function writeOutput(pairs) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return; // Local invocations (e.g. unit tests) don't need GHA outputs.
  const body = Object.entries(pairs)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  appendFileSync(out, body + '\n');
}

export async function refreshOAuthToken({
  refreshToken,
  zone,
  fetchImpl = fetch,
  now = Date.now(),
} = {}) {
  if (!refreshToken) {
    throw new Error('WIZARD_REFRESH_TOKEN is required');
  }
  const settings = ZONE_SETTINGS[zone ?? 'us'];
  if (!settings) {
    throw new Error(
      `WIZARD_ZONE must be 'us' or 'eu' (received: ${String(zone)})`,
    );
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: settings.oAuthClientId,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(`${settings.oAuthHost}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Hydra /oauth2/token returned ${response.status} ${response.statusText}` +
        (text ? ` — ${text.slice(0, 200)}` : ''),
    );
  }

  const data = await response.json();
  const accessToken = data.access_token;
  const expiresIn = data.expires_in;

  if (typeof accessToken !== 'string' || typeof expiresIn !== 'number') {
    throw new Error(
      `Unexpected response shape from Hydra: ` +
        `access_token=${typeof accessToken}, expires_in=${typeof expiresIn}`,
    );
  }

  // Hydra rotates the refresh token on every exchange when the OAuth
  // client is configured for rotation. If the server didn't return a new
  // one, echo the input — the existing token is still valid and the
  // workflow needs *some* value to write back.
  const rotatedRefreshToken =
    typeof data.refresh_token === 'string' ? data.refresh_token : refreshToken;

  const expiresAt = new Date(now + expiresIn * 1000).toISOString();

  return {
    accessToken,
    refreshToken: rotatedRefreshToken,
    expiresAt,
  };
}

async function main() {
  const refreshToken = process.env.WIZARD_REFRESH_TOKEN;
  const zone = process.env.WIZARD_ZONE || 'us';

  if (!refreshToken) {
    fail(
      'WIZARD_REFRESH_TOKEN is not set. Run `amplitude-wizard ci-bootstrap` ' +
        'against a freshly authenticated wizard session to seed it.',
    );
  }

  let result;
  try {
    result = await refreshOAuthToken({ refreshToken, zone });
  } catch (err) {
    fail(
      err instanceof Error
        ? `refresh failed: ${err.message}`
        : `refresh failed: ${String(err)}`,
    );
    return; // unreachable; satisfies linters
  }

  writeOutput({
    refresh: 'ok',
    access_token: result.accessToken,
    refresh_token: result.refreshToken,
    expires_at: result.expiresAt,
  });

  // Don't echo the token to stdout; only the masked GITHUB_OUTPUT path
  // is safe. Just confirm completion for run-log readability.
  process.stdout.write(
    `Refreshed Amplitude OAuth token (zone=${zone}, expires_at=${result.expiresAt})\n`,
  );
}

// Run only when invoked directly. Importing this file from a unit test
// re-uses `refreshOAuthToken` without firing the side effect.
const isDirectInvocation =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? '');
if (isDirectInvocation) {
  main().catch((err) => {
    fail(err instanceof Error ? err.message : String(err));
  });
}
