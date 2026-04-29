/**
 * Amplitude OAuth2/PKCE flow — adapted from Amplitude wizard's oauth.ts but
 * hitting Amplitude's auth endpoints (same as the ampli CLI).
 *
 * Key difference from Amplitude: checks ~/.ampli.json for an existing ampli CLI
 * session first, so users who ran `ampli login` can skip re-authenticating.
 */

import * as crypto from 'node:crypto';
import * as http from 'node:http';
import axios from 'axios';
import chalk from 'chalk';
import opn from 'opn';
import { z } from 'zod';
import { getUI } from '../ui/index.js';
import { logToFile } from './debug.js';
import {
  AMPLITUDE_ZONE_SETTINGS,
  DEFAULT_AMPLITUDE_ZONE,
  OUTBOUND_URLS,
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
import { withWizardSpan, addBreadcrumb } from '../lib/observability/index.js';

// SVG assets inlined from ../javascript
const AMPLITUDE_WORDMARK_SVG = `<svg width="154" height="32" viewBox="0 0 154 32" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M44.5719 5.76886L37.6178 23.2015H40.7052L42.0785 19.7126H49.446L50.7956 23.2015H53.9556L47.0134 5.76886H44.5719ZM43.1497 16.9289L45.763 10.2548L48.3526 16.9289H43.1497Z" fill="#1E61F0"/><path d="M69.76 10.7778C68.9245 10.7778 68.1556 10.9704 67.4504 11.3555C66.7452 11.7407 66.2222 12.2622 65.8815 12.917C65.16 11.4904 63.9037 10.7778 62.1126 10.7778C61.3911 10.7778 60.6963 10.9333 60.0282 11.2459C59.36 11.5585 58.8193 12.0593 58.4059 12.7467V11.0326H55.6459V23.2015H58.4059V16.3807C58.4059 15.4089 58.6711 14.6755 59.2015 14.1807C59.7319 13.6859 60.3704 13.4385 61.1156 13.4385C61.9422 13.4385 62.5941 13.6993 63.0726 14.2222C63.5511 14.7452 63.7896 15.4637 63.7896 16.3793V23.2H66.5733V16.3793C66.5733 15.4074 66.8371 14.6741 67.363 14.1793C67.8904 13.6844 68.5304 13.437 69.2845 13.437C70.1022 13.437 70.7467 13.6978 71.2178 14.2207C71.6874 14.7437 71.923 15.4622 71.923 16.3778V23.1985H74.7437V15.7585C74.7437 14.243 74.2845 13.0326 73.3645 12.1289C72.4445 11.2296 71.243 10.7778 69.76 10.7778Z" fill="#1E61F0"/><path d="M87.4741 11.6281C86.5867 11.0607 85.6119 10.7778 84.5496 10.7778C83.5778 10.7778 82.7215 10.9881 81.9852 11.4104C81.2474 11.8326 80.6548 12.4355 80.2104 13.2222V11.0341H77.4504V27.4578H80.2104V21.0148C80.6563 21.7926 81.2474 22.3926 81.9852 22.8133C82.723 23.2355 83.5778 23.4459 84.5496 23.4459C86.163 23.4459 87.5319 22.8311 88.6593 21.6044C89.7852 20.3763 90.3482 18.883 90.3482 17.1244C90.3482 15.9733 90.0904 14.9126 89.5763 13.9393C89.0622 12.9659 88.3615 12.1955 87.4741 11.6281ZM86.5556 19.7304C85.843 20.4474 84.9719 20.8059 83.9422 20.8059C82.8726 20.8059 81.9822 20.4533 81.2741 19.7481C80.5645 19.043 80.2104 18.1674 80.2104 17.1215C80.2104 16.0593 80.5645 15.1763 81.2741 14.4711C81.9837 13.7659 82.8726 13.4133 83.9422 13.4133C84.9719 13.4133 85.843 13.7718 86.5556 14.4889C87.2696 15.2059 87.6252 16.083 87.6252 17.1215C87.6267 18.1452 87.2696 19.0133 86.5556 19.7304Z" fill="#1E61F0"/><path d="M95.2978 5.76886H92.5378V23.2015H95.2978V5.76886Z" fill="#1E61F0"/><path d="M100.738 11.0326H97.9778V23.2015H100.738V11.0326Z" fill="#1E61F0"/><path d="M99.3763 5.37927C98.8904 5.37927 98.4726 5.55409 98.1245 5.90224C97.7763 6.25038 97.6015 6.66372 97.6015 7.14224C97.6015 7.63705 97.7748 8.05779 98.1245 8.40742C98.4726 8.75557 98.8904 8.93038 99.3763 8.93038C99.8622 8.93038 100.283 8.75557 100.636 8.40742C100.988 8.05927 101.164 7.63705 101.164 7.14224C101.164 6.66372 100.988 6.25038 100.636 5.90224C100.281 5.55409 99.8622 5.37927 99.3763 5.37927Z" fill="#1E61F0"/><path d="M107.594 7.76294H104.81V11.0326H102.501V13.6711H104.81V18.6192C104.81 20.1348 105.215 21.3022 106.027 22.12C106.837 22.9392 107.927 23.3481 109.296 23.3481C109.864 23.3481 110.363 23.2992 110.791 23.2015V20.637C110.541 20.7022 110.24 20.7348 109.892 20.7348C109.178 20.7348 108.618 20.5585 108.209 20.2059C107.8 19.8533 107.594 19.3081 107.594 18.5703V13.6711H110.791V11.0326H107.594V7.76294Z" fill="#1E61F0"/><path d="M121.44 17.6222C121.44 18.5778 121.167 19.3437 120.619 19.92C120.073 20.4948 119.35 20.7837 118.449 20.7837C117.557 20.7837 116.84 20.4963 116.296 19.92C115.753 19.3452 115.481 18.5793 115.481 17.6222V11.0326H112.721V17.9496C112.721 19.6593 113.172 21.003 114.071 21.9793C114.97 22.9556 116.206 23.4444 117.779 23.4444C118.582 23.4444 119.295 23.2578 119.919 22.8844C120.542 22.5126 121.049 21.9778 121.439 21.28V23.2015H124.222V11.0326H121.439V17.6222H121.44Z" fill="#1E61F0"/><path d="M136.486 13.1718C136.04 12.4015 135.453 11.8103 134.723 11.397C133.994 10.9837 133.147 10.7777 132.182 10.7777C131.12 10.7777 130.144 11.0577 129.253 11.6163C128.361 12.1748 127.656 12.9407 127.138 13.914C126.619 14.8874 126.36 15.9481 126.36 17.0992C126.36 18.2503 126.619 19.314 127.138 20.2903C127.656 21.2666 128.361 22.037 129.253 22.6C130.145 23.1629 131.121 23.4444 132.182 23.4444C133.147 23.4444 133.994 23.24 134.723 22.8296C135.452 22.4207 136.04 21.8311 136.486 21.0607V23.2H139.283V5.76886H136.486V13.1718ZM135.424 19.7437C134.714 20.4533 133.833 20.8074 132.779 20.8074C131.75 20.8074 130.879 20.4489 130.166 19.7318C129.452 19.0148 129.096 18.1377 129.096 17.0992C129.096 16.0785 129.453 15.2089 130.166 14.4918C130.879 13.7748 131.75 13.4163 132.779 13.4163C133.833 13.4163 134.714 13.7689 135.424 14.474C136.133 15.1792 136.487 16.0548 136.487 17.1007C136.486 18.1526 136.132 19.034 135.424 19.7437Z" fill="#1E61F0"/><path d="M153.591 16.8563C153.591 15.6978 153.323 14.6504 152.788 13.7141C152.253 12.7778 151.533 12.0548 150.63 11.5437C149.726 11.0326 148.73 10.7778 147.644 10.7778C146.493 10.7778 145.439 11.0533 144.477 11.6044C143.517 12.1555 142.759 12.9111 142.203 13.8711C141.647 14.8311 141.37 15.8918 141.37 17.0504C141.37 18.2415 141.647 19.3274 142.203 20.3081C142.759 21.2889 143.519 22.0563 144.483 22.6118C145.447 23.1674 146.517 23.4444 147.693 23.4444C149.193 23.4444 150.468 23.0548 151.523 22.277C152.576 21.4993 153.216 20.4696 153.444 19.1896H150.661C150.539 19.7081 150.209 20.1304 149.67 20.4533C149.13 20.7778 148.489 20.9393 147.742 20.9393C146.778 20.9393 145.988 20.68 145.372 20.1615C144.756 19.643 144.359 18.9304 144.181 18.0222H153.517C153.567 17.8044 153.591 17.4148 153.591 16.8563ZM144.255 15.6518C144.458 14.9052 144.841 14.3259 145.41 13.9126C145.978 13.4993 146.67 13.2918 147.489 13.2918C148.316 13.2918 149.006 13.5096 149.561 13.9422C150.117 14.3763 150.455 14.9452 150.576 15.6504H144.255V15.6518Z" fill="#1E61F0"/><path d="M14.1037 7.20294C14.0134 7.08739 13.9171 7.02368 13.8015 7.02368C13.7185 7.02961 13.6415 7.05627 13.5704 7.10072C12.7156 7.76887 11.5526 10.6029 10.5956 14.3422L11.4445 14.3481C13.1156 14.3674 14.843 14.3866 16.5467 14.4118C16.0963 12.7022 15.6726 11.237 15.2815 10.0489C14.7082 8.32146 14.323 7.54368 14.1037 7.20294Z" fill="#1E61F0"/><path d="M16 0C7.16444 0 0 7.16444 0 16C0 24.8356 7.16444 32 16 32C24.8356 32 32 24.8356 32 16C32 7.16444 24.8356 0 16 0ZM27.8104 15.8074C27.7659 15.9867 27.6563 16.1615 27.5022 16.2889C27.483 16.3022 27.4637 16.3141 27.4444 16.3274L27.4252 16.3407L27.3867 16.3659L27.3541 16.3852C27.2326 16.4489 27.0963 16.4815 26.9556 16.4815H19.3733C19.4311 16.7319 19.5022 17.0207 19.5719 17.3304C19.9896 19.123 21.0889 23.8904 22.2637 23.8904H22.2889H22.3022H22.3274C23.24 23.8904 23.7096 22.5674 24.7378 19.6681L24.7511 19.6356C24.9185 19.1733 25.1052 18.6459 25.3037 18.0874L25.3556 17.9467C25.4326 17.76 25.6444 17.6637 25.8311 17.7407C25.9659 17.7926 26.0622 17.9274 26.0622 18.0756C26.0622 18.1141 26.0563 18.1467 26.0489 18.1778L26.0044 18.3185C25.8948 18.6652 25.7867 19.1348 25.6504 19.6815C25.04 22.2133 24.1141 26.037 21.7496 26.037H21.7304C20.2015 26.0237 19.2889 23.5822 18.8963 22.5348C18.1644 20.5807 17.6119 18.5052 17.0785 16.4889H10.1141L8.66815 21.1215L8.64889 21.1022C8.43111 21.443 7.97482 21.5452 7.63407 21.3274C7.42222 21.1926 7.29333 20.9615 7.29333 20.7111V20.6859L7.3837 20.1585C7.58222 18.9704 7.82667 17.7289 8.0963 16.483H5.14074L5.12741 16.4696C4.52296 16.3793 4.10518 15.8148 4.19555 15.2104C4.26667 14.7407 4.62667 14.3689 5.08889 14.2844C5.20444 14.2711 5.32 14.2652 5.43556 14.2711H5.5763C6.50815 14.2844 7.49778 14.3037 8.58963 14.3156C10.1259 8.06963 11.9052 4.89481 13.8844 4.88889C16.0044 4.88889 17.5793 9.71407 18.8385 14.437L18.8444 14.4563C21.4281 14.5081 24.1911 14.5852 26.8696 14.7778L26.9852 14.7911C27.0296 14.7911 27.0681 14.797 27.1141 14.8044H27.1274L27.1407 14.8104H27.1467C27.6044 14.9007 27.9067 15.3511 27.8104 15.8074Z" fill="#1E61F0"/></svg>`;

const OAUTH_CALLBACK_STYLES = `
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
      background: #f5f6fa;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #1a1a2e;
    }
    .card {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 2px 16px rgba(0,0,0,0.08);
      padding: 48px 40px;
      max-width: 420px;
      width: 100%;
      text-align: center;
    }
    .logo { display: flex; justify-content: center; margin-bottom: 32px; }
    .check-icon {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: linear-gradient(135deg, #1D4AFF 0%, #1640d6 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
      color: #fff;
      box-shadow: 0 8px 24px rgba(29,74,255,0.25);
    }
    .icon {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
      font-size: 26px;
    }
    .icon-error { background: #fdecea; }
    h1 { font-size: 20px; font-weight: 600; color: #1a1a2e; margin-bottom: 10px; }
    p { font-size: 15px; color: #6b7280; line-height: 1.5; }
    .divider {
      border: none;
      border-top: 1px solid #e5e7eb;
      margin: 32px 0 24px;
    }
    .promo { text-align: left; }
    .promo-hint {
      font-size: 13px;
      color: #6b7280;
      line-height: 1.5;
      margin-top: 12px;
    }
    .promo-link {
      font-size: 13px;
      color: #1D4AFF;
      text-decoration: none;
      font-weight: 500;
    }
    .promo-link:hover { text-decoration: underline; }
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

/**
 * Compares two strings using a constant-time comparison to mitigate timing
 * side-channels (PR 335 — security hardening). Returns false immediately
 * when lengths differ (not a leak — length is also encoded by the
 * on-the-wire query string, and we only ever compare strings of fixed
 * wizard-generated length).
 */
function safeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Error thrown when no port in the OAUTH_PORT range is available. Callers
 * surface `userMessage` instead of the raw error.
 */
export class OAuthPortInUseError extends Error {
  readonly userMessage: string;
  readonly basePort: number;
  constructor(basePort: number) {
    const userMessage = `Couldn't open the local authorization server (port ${basePort} is in use). Close any other wizard runs on this machine and try again.`;
    super(userMessage);
    this.name = 'OAuthPortInUseError';
    this.userMessage = userMessage;
    this.basePort = basePort;
  }
}

/**
 * Maximum number of consecutive ports to try after OAUTH_PORT on EADDRINUSE.
 *
 * The Amplitude OAuth app only accepts redirect URIs whose port is in this
 * allowlisted range, which is why we don't use port 0 (OS-assigned).
 * Concurrent wizard runs each pick the next free port in the range.
 */
export const OAUTH_PORT_RETRY_LIMIT = 10;

// Re-exported (was non-export after PR 339's refactor wrapped this with
// the port-retry loop) so the state-validation unit tests from PR 335
// can drive it directly without going through the `__testing` shim.
export async function startCallbackServer(): Promise<{
  server: http.Server;
  port: number;
  waitForCallback: (expectedState: string) => Promise<string>;
}> {
  let lastErr: NodeJS.ErrnoException | undefined;
  for (let offset = 0; offset <= OAUTH_PORT_RETRY_LIMIT; offset++) {
    const candidate = OAUTH_PORT + offset;
    try {
      return await tryStartCallbackServer(candidate);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err && err.code === 'EADDRINUSE') {
        lastErr = err;
        continue;
      }
      throw e;
    }
  }
  // Exhausted retries — surface a typed error with helpful copy.
  void lastErr;
  throw new OAuthPortInUseError(OAUTH_PORT);
}

function tryStartCallbackServer(port: number): Promise<{
  server: http.Server;
  port: number;
  waitForCallback: (expectedState: string) => Promise<string>;
}> {
  return new Promise((resolve, reject) => {
    let callbackResolve: (code: string) => void;
    let callbackReject: (error: Error) => void;
    let expectedStateClosure: string | null = null;

    const waitForCallback = (expectedState: string) =>
      new Promise<string>((res, rej) => {
        callbackResolve = res;
        callbackReject = rej;
        expectedStateClosure = expectedState;
      });

    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400);
        res.end();
        return;
      }
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      const stateParam = url.searchParams.get('state');

      if (error) {
        const cancelled = error === 'access_denied';
        res.writeHead(cancelled ? 200 : 400, {
          'Content-Type': 'text/html; charset=utf-8',
        });
        res.end(
          `<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Amplitude</title>${OAUTH_CALLBACK_STYLES}</head><body><div class="card"><div class="logo">${AMPLITUDE_WORDMARK_SVG}</div><div class="icon icon-error">✕</div><h1>${
            cancelled ? 'Sign-in cancelled' : 'Sign-in failed'
          }</h1><p>${
            cancelled
              ? 'You cancelled the sign-in.'
              : 'Something went wrong during sign-in.'
          } You can close this tab and return to your terminal.</p></div><script>window.close();</script></body></html>`,
        );
        callbackReject(new Error(`OAuth error: ${error}`));
        return;
      }

      // CSRF defense: validate `state` against the value generated when the
      // OAuth flow began. Mismatch (or missing) indicates a forged callback
      // (e.g. a malicious site forcing the wizard to consume the attacker's
      // auth code) — reject loudly without exchanging the code.
      if (
        !stateParam ||
        !expectedStateClosure ||
        !safeEqualString(stateParam, expectedStateClosure)
      ) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          `<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Amplitude</title>${OAUTH_CALLBACK_STYLES}</head><body><div class="card"><div class="logo">${AMPLITUDE_WORDMARK_SVG}</div><div class="icon icon-error">✕</div><h1>Invalid request</h1><p>This sign-in link is invalid or has expired. Please try again from your terminal.</p></div></body></html>`,
        );
        callbackReject(
          new Error('OAuth state mismatch — possible CSRF, callback rejected'),
        );
        return;
      }

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          `<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Amplitude</title>${OAUTH_CALLBACK_STYLES}</head><body><div class="card"><div class="logo">${AMPLITUDE_WORDMARK_SVG}</div><div class="check-icon"><svg width="32" height="32" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd"/></svg></div><h1>You're signed in</h1><p>You may now close this window and return to the CLI.</p><hr class="divider"><div class="promo"><p class="promo-hint">If you want to check out Amplitude outside of the CLI, <a class="promo-link" href="https://app.amplitude.com" target="_blank" rel="noopener">open Amplitude here →</a></p></div></div><script>window.close();</script></body></html>`,
        );
        callbackResolve(code);
      } else {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          `<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Amplitude</title>${OAUTH_CALLBACK_STYLES}</head><body><div class="card"><div class="logo">${AMPLITUDE_WORDMARK_SVG}</div><div class="icon icon-error">✕</div><h1>Invalid request</h1><p>This sign-in link is invalid or has expired. Please try again from your terminal.</p></div></body></html>`,
        );
      }
    });

    // Single-shot error handler for the listen() call. Detached after
    // listen succeeds so later runtime errors don't reject this
    // already-resolved promise.
    const onListenError = (err: Error) => reject(err);
    server.once('error', onListenError);

    // Bind to 127.0.0.1 only — the OAuth callback should NEVER be
    // reachable from other hosts on the network. Listening on 0.0.0.0
    // would let an attacker on the same LAN race the user's browser to
    // deliver a forged callback. (PR 339 made the port dynamic so
    // concurrent wizard runs don't EADDRINUSE-collide.)
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onListenError);
      resolve({ server, port, waitForCallback });
    });
  });
}

/** Exported for tests only. */
export const __testing = {
  /** Bind to a single concrete port — exposed so tests can simulate EADDRINUSE
   *  without going through the OAUTH_PORT-anchored retry loop. */
  tryStartCallbackServer: (port: number) => tryStartCallbackServer(port),
  /** Run the retry loop. */
  startCallbackServer: () => startCallbackServer(),
  closeServer: (server: http.Server) => closeServer(server),
};

/** Closes an HTTP server, swallowing errors. Idempotent. */
function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
  zone: AmplitudeZone,
  redirectPort: number,
): Promise<OAuthTokenResponse> {
  const { oAuthHost, oAuthClientId } = AMPLITUDE_ZONE_SETTINGS[zone];
  const response = await axios.post(
    `${oAuthHost}/oauth2/token`,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `http://localhost:${redirectPort}/callback`,
      client_id: oAuthClientId,
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
 * 1. Checks ~/.ampli.json for a valid existing session (shared with ampli CLI),
 *    unless forceFresh is true (used for new projects with no local ampli.json).
 * 2. If none, opens the browser to auth.amplitude.com and awaits callback.
 * 3. Stores the resulting tokens back to ~/.ampli.json.
 */
export async function performAmplitudeAuth(options: {
  zone?: AmplitudeZone;
  /** Skip cached credentials and require fresh browser auth. */
  forceFresh?: boolean;
  /**
   * Optional abort signal — when triggered, closes the local callback server
   * and rejects the auth promise with an AbortError. Lets SIGINT/cleanup
   * paths reclaim the OAuth port without waiting for the 2-minute timeout.
   */
  signal?: AbortSignal;
}): Promise<AmplitudeAuthResult> {
  return withWizardSpan(
    'auth.oauth.login',
    'auth.oauth',
    {
      zone: options.zone ?? DEFAULT_AMPLITUDE_ZONE,
      force_fresh: options.forceFresh ?? false,
    },
    async () => performAmplitudeAuthInner(options),
  );
}

async function performAmplitudeAuthInner(options: {
  zone?: AmplitudeZone;
  forceFresh?: boolean;
  signal?: AbortSignal;
}): Promise<AmplitudeAuthResult> {
  const zone = options.zone ?? DEFAULT_AMPLITUDE_ZONE;

  // ── 1. Try existing ampli CLI session ────────────────────────────
  // Skip when forceFresh — used for new projects where we don't know
  // which org applies, so the user must explicitly authenticate.
  logToFile('[oauth] performAmplitudeAuth called', {
    zone,
    forceFresh: options.forceFresh,
  });

  if (!options.forceFresh) {
    const existing = getStoredToken(undefined, zone);
    logToFile(
      '[oauth] getStoredToken result',
      existing
        ? {
            idToken: existing.idToken?.slice(0, 20) + '…',
            hasAccess: !!existing.accessToken,
            hasRefresh: !!existing.refreshToken,
          }
        : null,
    );
    if (existing) {
      getUI().log.info(
        chalk.dim('Using existing Amplitude session from ~/.ampli.json'),
      );
      addBreadcrumb('auth', 'Reused cached ampli session');
      return {
        idToken: existing.idToken,
        accessToken: existing.accessToken,
        refreshToken: existing.refreshToken,
        zone,
      };
    }
  }
  addBreadcrumb('auth', 'Starting fresh OAuth flow', { zone });

  // ── 2. Fresh OAuth flow ──────────────────────────────────────────
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();
  const { oAuthHost, oAuthClientId } = AMPLITUDE_ZONE_SETTINGS[zone];

  // Bind the server first so we know which port to advertise as redirect_uri.
  // Concurrent wizard runs step through the OAUTH_PORT range until one is free.
  let serverHandle: {
    server: http.Server;
    port: number;
    waitForCallback: (expectedState: string) => Promise<string>;
  };
  try {
    serverHandle = await startCallbackServer();
  } catch (e) {
    if (e instanceof OAuthPortInUseError) {
      getUI().log.error(
        `${chalk.red('Authorization failed:')}\n\n${e.userMessage}`,
      );
      analytics.captureException(e, { step: 'oauth_port_in_use' });
      await abort();
      throw e;
    }
    throw e;
  }
  const { server, port, waitForCallback } = serverHandle;

  const authUrl = new URL(`${oAuthHost}/oauth2/auth`);
  authUrl.searchParams.set('client_id', oAuthClientId);
  authUrl.searchParams.set('redirect_uri', `http://localhost:${port}/callback`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('scope', 'openid offline');
  authUrl.searchParams.set('state', state);
  // Forward the CLI install UUID so a future onenav change can stitch
  // browser-side auth events to the CLI's Amplitude device_id. Hydra strips
  // unknown params on its redirect to the login page today, so this is inert
  // until the login page (or its server) opts in to reading it.
  authUrl.searchParams.set('amp_device_id', analytics.getAnonymousId());

  getUI().setLoginUrl(authUrl.toString());

  if (process.env.NODE_ENV !== 'test') {
    opn(authUrl.toString(), { wait: false }).catch(() => {
      // No browser — user will copy-paste the URL shown by the TUI
    });
  }

  const spinner = getUI().spinner();
  spinner.start('Waiting for Amplitude authorization...');

  // Abort wiring — when the wizard-wide signal fires (SIGINT, /exit, etc.)
  // close the server immediately so the next run can reclaim the port.
  let abortReject: ((err: Error) => void) | null = null;
  const abortPromise = new Promise<never>((_, reject) => {
    abortReject = reject;
  });
  const onAbort = () => {
    if (abortReject) {
      const err = new Error('Authorization aborted');
      err.name = 'AbortError';
      abortReject(err);
    }
  };
  if (options.signal) {
    if (options.signal.aborted) {
      onAbort();
    } else {
      options.signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  try {
    const code = await Promise.race([
      waitForCallback(state),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Authorization timed out')), 120_000),
      ),
      abortPromise,
    ]);

    logToFile('[oauth] auth code received, exchanging for token');
    addBreadcrumb('auth', 'Auth code received, exchanging for token');
    const tokenResponse = await withWizardSpan(
      'auth.oauth.exchange_code',
      'auth.oauth',
      { zone },
      async () => exchangeCodeForToken(code, codeVerifier, zone, port),
    );
    logToFile('[oauth] token exchange response', {
      token_type: tokenResponse.token_type,
      expires_in: tokenResponse.expires_in,
      has_access_token: !!tokenResponse.access_token,
      has_id_token: !!tokenResponse.id_token,
      has_refresh_token: !!tokenResponse.refresh_token,
      access_token_prefix: tokenResponse.access_token?.slice(0, 20) + '…',
      id_token_prefix: tokenResponse.id_token?.slice(0, 20) + '…',
    });

    getUI().setLoginUrl(null);
    spinner.stop('Authorization complete!');

    const result: AmplitudeAuthResult = {
      idToken: tokenResponse.id_token,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      zone,
    };

    // ── 3. Persist to ~/.ampli.json (shared with ampli CLI) ──────────
    // User details (name/email) are filled in after fetchAmplitudeUser().
    // storeToken() uses atomicWriteJSON (temp + rename) — concurrent wizard
    // runs cannot corrupt the file. Last-writer-wins for the access token
    // is acceptable since all issued refresh tokens stay valid.
    //
    // Stored `expiresAt` tracks the id_token's TTL (1h on Ory's default
    // OIDC config), not the access_token's `expires_in` (24h). The
    // wizard authenticates with the id_token, so `tryRefreshToken` must
    // refresh on id_token expiry to avoid 401s mid-run. Falls back to
    // `expires_in` if the JWT can't be decoded — never strictly worse.
    const { resolveStoredExpiryMs } = await import('./jwt-exp.js');
    const expiresAt = new Date(
      resolveStoredExpiryMs({
        idToken: tokenResponse.id_token,
        expiresInSeconds: tokenResponse.expires_in,
      }),
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
    logToFile('[oauth] token stored to ~/.ampli.json, returning result', {
      zone,
      expiresAt,
    });

    return result;
  } catch (e) {
    spinner.stop('Authorization failed.');
    const error = e instanceof Error ? e : new Error('Unknown error');
    logToFile('[oauth] error during auth flow', error);

    if (error.name === 'AbortError') {
      // Wizard-level cancellation — caller already surfaces this; stay quiet.
    } else if (error.message.includes('timeout')) {
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
        }\n\n${chalk.dim(`File an issue:\n${OUTBOUND_URLS.githubIssues}`)}`,
      );
    }

    analytics.captureException(error, { step: 'oauth_flow' });
    await abort();
    throw error;
  } finally {
    // Always release the port — timeout, success, error, or abort. Without
    // this, a SIGINT during browser auth leaves the listener bound and the
    // next wizard run hits EADDRINUSE.
    if (options.signal) {
      options.signal.removeEventListener('abort', onAbort);
    }
    await closeServer(server);
  }
}

/**
 * Exchanges a stored refresh token for a new access token.
 * Uses the same /oauth2/token endpoint as the initial auth-code exchange.
 */
export async function refreshAccessToken(
  refreshToken: string,
  zone: AmplitudeZone = DEFAULT_AMPLITUDE_ZONE,
): Promise<{
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresAt: string;
}> {
  const { oAuthHost, oAuthClientId } = AMPLITUDE_ZONE_SETTINGS[zone];
  const response = await axios.post(
    `${oAuthHost}/oauth2/token`,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: oAuthClientId,
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  const parsed = OAuthTokenResponseSchema.parse(response.data);
  // Source `expiresAt` from the rotated id_token's `exp` claim — the
  // id_token's TTL is the binding constraint for our API calls. See
  // `src/utils/jwt-exp.ts` for rationale. Falls back to `expires_in`
  // when the JWT can't be decoded.
  const { resolveStoredExpiryMs } = await import('./jwt-exp.js');
  return {
    accessToken: parsed.access_token,
    idToken: parsed.id_token,
    refreshToken: parsed.refresh_token,
    expiresAt: new Date(
      resolveStoredExpiryMs({
        idToken: parsed.id_token,
        expiresInSeconds: parsed.expires_in,
      }),
    ).toISOString(),
  };
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
