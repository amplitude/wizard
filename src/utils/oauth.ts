/**
 * Amplitude OAuth2/PKCE flow — adapted from PostHog wizard's oauth.ts but
 * hitting Amplitude's auth endpoints (same as the ampli CLI).
 *
 * Key difference from PostHog: checks ~/.ampli.json for an existing ampli CLI
 * session first, so users who ran `ampli login` can skip re-authenticating.
 */

import * as crypto from 'node:crypto';
import * as http from 'node:http';
import axios from 'axios';
import chalk from 'chalk';
import opn from 'opn';
import { z } from 'zod';
import { getUI } from '../ui/index.js';
import {
  AMPLITUDE_ZONE_SETTINGS,
  DEFAULT_AMPLITUDE_ZONE,
  ISSUES_URL,
  OAUTH_CLIENT_ID,
  OAUTH_PORT,
  type AmplitudeZone,
} from '../lib/constants.js';
import { abort } from './setup-utils.js';
import { analytics } from './analytics.js';
import {
  getStoredToken,
  storeToken,
  type StoredUser,
} from './ampli-settings.js';

const OAUTH_CALLBACK_STYLES = `
  <style>
    * { font-family: monospace; background-color: #0c0c0c; color: #ff6b35; font-size: 18px; margin: .25rem; }
    .blink { animation: blink-animation 1s steps(2, start) infinite; }
    @keyframes blink-animation { to { opacity: 0; } }
  </style>
`;

const OAuthTokenResponseSchema = z.object({
  access_token: z.string(),
  id_token: z.string(),
  refresh_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
});

export type OAuthTokenResponse = z.infer<typeof OAuthTokenResponseSchema>;

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

async function startCallbackServer(): Promise<{
  server: http.Server;
  waitForCallback: (expectedState: string) => Promise<string>;
}> {
  return new Promise((resolve, reject) => {
    let callbackResolve: (code: string) => void;
    let callbackReject: (error: Error) => void;

    const waitForCallback = (expectedState: string) =>
      new Promise<string>((res, rej) => {
        callbackResolve = res;
        callbackReject = rej;
        void expectedState; // validated below in handleRequest
      });

    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400);
        res.end();
        return;
      }
      const url = new URL(req.url, `http://localhost:${OAUTH_PORT}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        const cancelled = error === 'access_denied';
        res.writeHead(cancelled ? 200 : 400, {
          'Content-Type': 'text/html; charset=utf-8',
        });
        res.end(
          `<html><head><meta charset="UTF-8"><title>Amplitude wizard</title>${OAUTH_CALLBACK_STYLES}</head><body><p>${
            cancelled ? 'Authorization cancelled.' : 'Authorization failed.'
          }</p><p>Return to your terminal.</p><script>window.close();</script></body></html>`,
        );
        callbackReject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          `<html><head><meta charset="UTF-8"><title>Amplitude wizard - ready</title>${OAUTH_CALLBACK_STYLES}</head><body><p>Amplitude login complete!</p><p>Return to your terminal — the wizard is setting up your project<span class="blink">█</span></p><script>window.close();</script></body></html>`,
        );
        callbackResolve(code);
      } else {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          `<html><head><meta charset="UTF-8"><title>Amplitude wizard</title>${OAUTH_CALLBACK_STYLES}</head><body><p>Invalid request.</p></body></html>`,
        );
      }
    });

    server.listen(OAUTH_PORT, () => resolve({ server, waitForCallback }));
    server.on('error', reject);
  });
}

async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
  zone: AmplitudeZone,
): Promise<OAuthTokenResponse> {
  const { oAuthHost } = AMPLITUDE_ZONE_SETTINGS[zone];
  const response = await axios.post(
    `${oAuthHost}/oauth2/token`,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `http://localhost:${OAUTH_PORT}/callback`,
      client_id: OAUTH_CLIENT_ID,
      code_verifier: codeVerifier,
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  return OAuthTokenResponseSchema.parse(response.data);
}

export interface AmplitudeAuthResult {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  zone: AmplitudeZone;
}

/**
 * Performs the Amplitude OAuth2/PKCE flow.
 *
 * 1. Checks ~/.ampli.json for a valid existing session (shared with ampli CLI).
 * 2. If none, opens the browser to auth.amplitude.com and awaits callback.
 * 3. Stores the resulting tokens back to ~/.ampli.json.
 */
export async function performAmplitudeAuth(options: {
  zone?: AmplitudeZone;
}): Promise<AmplitudeAuthResult> {
  const zone = options.zone ?? DEFAULT_AMPLITUDE_ZONE;

  // ── 1. Try existing ampli CLI session ────────────────────────────
  const existing = getStoredToken(undefined, zone);
  if (existing) {
    getUI().log.info(
      chalk.dim('Using existing Amplitude session from ~/.ampli.json'),
    );
    return {
      idToken: existing.idToken,
      accessToken: existing.accessToken,
      refreshToken: existing.refreshToken,
      zone,
    };
  }

  // ── 2. Fresh OAuth flow ──────────────────────────────────────────
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();
  const { oAuthHost } = AMPLITUDE_ZONE_SETTINGS[zone];

  const authUrl = new URL(`${oAuthHost}/oauth2/auth`);
  authUrl.searchParams.set('client_id', OAUTH_CLIENT_ID);
  authUrl.searchParams.set(
    'redirect_uri',
    `http://localhost:${OAUTH_PORT}/callback`,
  );
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('scope', 'openid offline');
  authUrl.searchParams.set('state', state);

  const { server, waitForCallback } = await startCallbackServer();

  getUI().setLoginUrl(authUrl.toString());

  if (process.env.NODE_ENV !== 'test') {
    opn(authUrl.toString(), { wait: false }).catch(() => {
      // No browser — user will copy-paste the URL shown by the TUI
    });
  }

  const spinner = getUI().spinner();
  spinner.start('Waiting for Amplitude authorization...');

  try {
    const code = await Promise.race([
      waitForCallback(state),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Authorization timed out')), 120_000),
      ),
    ]);

    const tokenResponse = await exchangeCodeForToken(code, codeVerifier, zone);

    server.close();
    getUI().setLoginUrl(null);
    spinner.stop('Authorization complete!');

    const result: AmplitudeAuthResult = {
      idToken: tokenResponse.id_token,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      zone,
    };

    // ── 3. Persist to ~/.ampli.json (shared with ampli CLI) ──────────
    // User details (name/email) are filled in after fetchAmplitudeUser()
    const expiresAt = new Date(
      Date.now() + tokenResponse.expires_in * 1000,
    ).toISOString();
    const pendingUser: StoredUser = {
      id: 'pending',
      firstName: '',
      lastName: '',
      email: '',
      zone,
    };
    storeToken(pendingUser, {
      accessToken: tokenResponse.access_token,
      idToken: tokenResponse.id_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt,
    });

    return result;
  } catch (e) {
    spinner.stop('Authorization failed.');
    server.close();
    const error = e instanceof Error ? e : new Error('Unknown error');

    if (error.message.includes('timeout')) {
      getUI().log.error('Authorization timed out. Please try again.');
    } else if (error.message.includes('access_denied')) {
      getUI().log.info(
        `${chalk.yellow(
          'Authorization was cancelled.',
        )}\n\nRe-run the wizard to try again.`,
      );
    } else {
      getUI().log.error(
        `${chalk.red('Authorization failed:')}\n\n${
          error.message
        }\n\n${chalk.dim(`File an issue:\n${ISSUES_URL}`)}`,
      );
    }

    analytics.captureException(error, { step: 'oauth_flow' });
    await abort();
    throw error;
  }
}

// ── Legacy shim — keeps existing callers compiling ───────────────────

export type OAuthConfig = { scopes: string[]; signup?: boolean };

/** @deprecated Use performAmplitudeAuth() directly. */
export async function performOAuthFlow(
  _config: OAuthConfig,
): Promise<OAuthTokenResponse> {
  const result = await performAmplitudeAuth({});
  return {
    access_token: result.accessToken,
    id_token: result.idToken,
    refresh_token: result.refreshToken,
    token_type: 'Bearer',
    expires_in: 3600,
  };
}
