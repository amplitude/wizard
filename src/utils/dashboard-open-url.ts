/**
 * Canonical Amplitude dashboard URLs (from MCP / dashboard.json) open more
 * reliably for new users when routed through `/login` with the sign-up /
 * sign-in refresh feature flag plus a `next` path back to the dashboard.
 */

const AMPLITUDE_APP_DASHBOARD_HOSTS = new Set([
  'app.amplitude.com',
  'app.eu.amplitude.com',
]);

/** Same key the web app reads for magic-link–style refreshed auth. */
export const SIGN_UP_SIGN_IN_REFRESH_FF = 'ff.sign-up-sign-in-refresh';

/**
 * Returns a `/login?next=…&ff.sign-up-sign-in-refresh=true` URL for Amplitude
 * app dashboard links; passes through unrecognized URLs unchanged.
 */
export function toWizardDashboardOpenUrl(
  canonicalDashboardUrl: string,
): string {
  const trimmed = canonicalDashboardUrl.trim();
  try {
    const parsed = new URL(trimmed);
    if (!AMPLITUDE_APP_DASHBOARD_HOSTS.has(parsed.hostname)) {
      return trimmed;
    }
    const login = new URL('/login', `${parsed.protocol}//${parsed.host}`);
    login.searchParams.set('next', `${parsed.pathname}${parsed.search}`);
    login.searchParams.set(SIGN_UP_SIGN_IN_REFRESH_FF, 'true');
    return login.toString();
  } catch {
    return trimmed;
  }
}
