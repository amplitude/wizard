/**
 * Shared "complete auth" pipeline used by both the interactive (browser
 * OAuth) path and the non-interactive (headless signup) path.
 *
 * Given freshly obtained OAuth tokens, fetch the user's org/workspace info,
 * persist the token to ~/.ampli.json, update analytics identity, and
 * optionally signal the TUI store that OAuth is complete.
 */

import type { AmplitudeZone } from '../lib/constants.js';
import type { AmplitudeUserInfo } from '../lib/api.js';

interface AuthTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  zone: AmplitudeZone;
}

interface MinimalSession {
  userEmail: string | null;
}

interface MinimalAnalytics {
  setDistinctId: (id: string) => void;
  identifyUser: (props: { email: string }) => void;
}

interface MinimalTui {
  store: {
    setLoginUrl: (url: string | null) => void;
    setOAuthComplete: (data: {
      accessToken: string;
      idToken: string;
      cloudRegion: AmplitudeZone;
      orgs: AmplitudeUserInfo['orgs'];
    }) => void;
  };
}

export interface CompleteAuthDeps {
  tui?: MinimalTui;
  session: MinimalSession;
  auth: AuthTokens;
  analytics: MinimalAnalytics;
  performAmplitudeAuth: (opts: {
    zone: AmplitudeZone;
    forceFresh: boolean;
  }) => Promise<AuthTokens>;
  fetchAmplitudeUser: (
    idToken: string,
    zone: AmplitudeZone,
  ) => Promise<AmplitudeUserInfo>;
  storeToken: (
    user: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
      zone: AmplitudeZone;
    },
    token: {
      accessToken: string;
      idToken: string;
      refreshToken: string;
      expiresAt: string;
    },
  ) => void;
  /**
   * When false, do NOT silently fall back to a browser OAuth flow if
   * fetchAmplitudeUser fails — re-throw instead so callers can surface
   * the error. Defaults to true to preserve the interactive behavior.
   */
  allowBrowserRecovery?: boolean;
}

export async function completeAuth({
  tui,
  session,
  auth,
  analytics,
  performAmplitudeAuth,
  fetchAmplitudeUser,
  storeToken,
  allowBrowserRecovery = true,
}: CompleteAuthDeps): Promise<void> {
  const cloudRegion = auth.zone;

  let userInfo;
  try {
    userInfo = await fetchAmplitudeUser(auth.idToken, cloudRegion);
  } catch (err) {
    if (!allowBrowserRecovery) {
      throw new Error(
        `Failed to fetch Amplitude user info: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { cause: err },
      );
    }
    // Token may be expired — re-open the browser for a fresh login
    tui?.store.setLoginUrl(null);
    const freshAuth = await performAmplitudeAuth({
      zone: cloudRegion,
      forceFresh: true,
    });
    userInfo = await fetchAmplitudeUser(freshAuth.idToken, cloudRegion);
    auth = { ...freshAuth };
  }

  storeToken(
    {
      id: userInfo.id,
      firstName: userInfo.firstName,
      lastName: userInfo.lastName,
      email: userInfo.email,
      zone: auth.zone,
    },
    {
      accessToken: auth.accessToken,
      idToken: auth.idToken,
      refreshToken: auth.refreshToken,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    },
  );

  session.userEmail = userInfo.email;
  analytics.setDistinctId(userInfo.email);
  analytics.identifyUser({ email: userInfo.email });

  tui?.store.setOAuthComplete({
    accessToken: auth.accessToken,
    idToken: auth.idToken,
    cloudRegion,
    orgs: userInfo.orgs,
  });
}
