/**
 * Reads and writes OAuth tokens and wizard-scoped session data under
 * `~/.amplitude/wizard/oauth-session.json` (canonical). Migrates from legacy
 * `~/.ampli.json` on first read when the canonical file has no OAuth entries.
 *
 * JSON shape matches the historical on-disk format (nested `User-*` entries
 * with OAuth* keys) so tokens remain portable across wizard versions.
 */

import * as fs from 'node:fs';
import { z } from 'zod';
import {
  AMPLITUDE_ZONE_SETTINGS,
  type AmplitudeZone,
  DEFAULT_AMPLITUDE_ZONE,
} from '../lib/constants.js';
import { createLogger } from '../lib/observability/logger.js';
import { atomicWriteJSON } from './atomic-write.js';
import { decodeJwtIssAud } from './jwt-exp.js';
import {
  ensureDir,
  getCacheRoot,
  getLegacyAmpliHomeOAuthPath,
  getOAuthSettingsFile,
} from './storage-paths.js';

const log = createLogger('ampli-settings');

/** @deprecated Use {@link getOAuthSettingsFile} — kept for tests and imports. */
export const AMPLI_CONFIG_PATH = getLegacyAmpliHomeOAuthPath();

export interface StoredOAuthToken {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresAt: string; // ISO date string
}

export interface StoredUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  zone: AmplitudeZone;
  tosAccepted?: boolean;
  tosAcceptedAt?: string; // ISO date string
}

const AmpliSettingsFileSchema = z.record(z.string(), z.unknown());

function readConfigFileDisk(pathname: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(pathname, 'utf-8');
    const result = AmpliSettingsFileSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}

function oauthEntriesPresent(config: Record<string, unknown>): boolean {
  return Object.keys(config).some((k) => isUserKey(k));
}

/**
 * When `explicitPath` is set, only that file is read (tests / special cases).
 * Otherwise merge canonical + legacy: prefer canonical when it already holds
 * OAuth user keys; otherwise load legacy, migrate forward best-effort.
 */
function readConfig(explicitPath?: string): Record<string, unknown> {
  if (explicitPath) {
    return readConfigFileDisk(explicitPath);
  }
  const primaryPath = getOAuthSettingsFile();
  const legacyPath = getLegacyAmpliHomeOAuthPath();
  const primary = readConfigFileDisk(primaryPath);
  const legacy = readConfigFileDisk(legacyPath);

  if (oauthEntriesPresent(primary)) {
    return primary;
  }
  if (oauthEntriesPresent(legacy)) {
    const merged: Record<string, unknown> = { ...legacy, ...primary };
    try {
      ensureDir(getCacheRoot());
      atomicWriteJSON(primaryPath, merged, 0o600);
    } catch (err) {
      log.debug('readConfig: could not migrate legacy OAuth file forward', {
        'error message': err instanceof Error ? err.message : String(err),
      });
    }
    return merged;
  }
  return Object.keys(primary).length > 0 ? primary : legacy;
}

function writeConfig(
  data: Record<string, unknown>,
  explicitPath?: string,
): void {
  if (explicitPath) {
    atomicWriteJSON(explicitPath, data, 0o600);
    return;
  }
  const primaryPath = getOAuthSettingsFile();
  const legacyPath = getLegacyAmpliHomeOAuthPath();
  try {
    ensureDir(getCacheRoot());
    atomicWriteJSON(primaryPath, data, 0o600);
  } catch (err) {
    log.warn('writeConfig: failed to write canonical OAuth session file', {
      'error message': err instanceof Error ? err.message : String(err),
    });
  }
  try {
    atomicWriteJSON(legacyPath, data, 0o600);
  } catch (err) {
    log.debug('writeConfig: legacy OAuth mirror write failed (non-fatal)', {
      'error message': err instanceof Error ? err.message : String(err),
    });
  }
}

function userKey(userId: string, zone: AmplitudeZone): string {
  const safeId = userId.replace(/\./g, '-');
  return zone !== DEFAULT_AMPLITUDE_ZONE
    ? `User[${zone}]-${safeId}`
    : `User-${safeId}`;
}

function isUserKey(key: string): boolean {
  return key.startsWith('User-') || key.startsWith('User[');
}

/**
 * True iff a given session-store key belongs to the requested zone.
 *
 * Key shapes:
 *   - US (the default zone): `User-<userId>`
 *   - Non-default zones:     `User[<zone>]-<userId>`
 *
 * Without this filter, `getStoredToken(undefined, 'eu')` would happily return
 * a US session because `isUserKey('User-…')` is true regardless of zone.
 * That made `/region` switches silently reuse the wrong-zone OAuth token,
 * fall back to a fresh browser login at the wrong host, and leave the user
 * staring at a US auth URL after picking EU.
 */
function isUserKeyForZone(key: string, zone: AmplitudeZone): boolean {
  if (zone === DEFAULT_AMPLITUDE_ZONE) {
    // US keys are unbracketed: `User-…` but never `User[…]-…`.
    return key.startsWith('User-');
  }
  return key.startsWith(`User[${zone}]-`);
}

const StoredUserSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  zone: z.string(),
  tosAccepted: z.boolean().optional(),
  tosAcceptedAt: z.string().optional(),
});

const UserEntrySchema = z
  .object({
    User: StoredUserSchema.optional(),
  })
  .passthrough();

/** Returns the first real (non-pending) stored user, or undefined if none. */
export function getStoredUser(configPath?: string): StoredUser | undefined {
  const config = readConfig(configPath);
  let fallback: StoredUser | undefined;
  for (const [key, value] of Object.entries(config)) {
    if (!isUserKey(key)) continue;
    const entry = UserEntrySchema.safeParse(value);
    if (!entry.success || !entry.data.User) continue;
    const user = entry.data.User as StoredUser;
    // Skip the "pending" placeholder — prefer a real user with an actual ID
    if (user.id === 'pending') {
      fallback = fallback ?? user;
      continue;
    }
    return user;
  }
  return fallback;
}

/** Returns a valid (non-expired) stored token, or undefined. */
export function getStoredToken(
  userId?: string,
  zone: AmplitudeZone = DEFAULT_AMPLITUDE_ZONE,
  configPath?: string,
): StoredOAuthToken | undefined {
  const config = readConfig(configPath);

  const OAuthEntrySchema = z
    .object({
      OAuthAccessToken: z.string(),
      OAuthIdToken: z.string(),
      OAuthRefreshToken: z.string(),
      OAuthExpiresAt: z.string(),
    })
    .passthrough();

  const findToken = (key: string): StoredOAuthToken | undefined => {
    const parsed = OAuthEntrySchema.safeParse(config[key]);
    if (!parsed.success) return undefined;
    const entry = parsed.data;
    const expiresAt = new Date(entry.OAuthExpiresAt);
    const refreshExpiry = new Date(
      expiresAt.getTime() + 364 * 24 * 60 * 60 * 1000,
    );
    if (new Date() > refreshExpiry) return undefined;

    // Drop tokens that were minted against a different OAuth client/issuer
    // than this wizard build is configured to use. Catches the "upgraded
    // from an old wizard version" case where the refresh-window check would
    // otherwise return a token whose audience/issuer no longer matches the
    // current AMPLITUDE_ZONE_SETTINGS — leading to silent 401s mid-run.
    //
    // Only enforced when the token actually carries `iss`/`aud` claims and
    // the expected values are known. Tokens without claims (or where decode
    // fails) fall through to the pre-existing behavior — never strictly
    // worse than before.
    const expected = AMPLITUDE_ZONE_SETTINGS[zone];
    const claims = decodeJwtIssAud(entry.OAuthIdToken);
    if (claims && expected) {
      // Compare only the host portion of `iss` against `oAuthHost`. Ory
      // mints tokens with `iss = "<oAuthHost>/"` (trailing slash); we strip
      // it for a robust prefix-style check that survives minor path tweaks.
      const expectedHost = (() => {
        try {
          return new URL(expected.oAuthHost).host;
        } catch {
          return null;
        }
      })();
      const issHost = claims.iss
        ? (() => {
            try {
              return new URL(claims.iss).host;
            } catch {
              return null;
            }
          })()
        : null;
      if (
        expectedHost &&
        issHost &&
        issHost !== expectedHost &&
        // Allow legacy tokens that omit `iss` entirely — only reject explicit
        // mismatches.
        true
      ) {
        log.debug('getStoredToken: dropping token with mismatched issuer', {
          key,
          expectedHost,
          issHost,
        });
        return undefined;
      }
      if (
        claims.aud &&
        claims.aud.length > 0 &&
        !claims.aud.includes(expected.oAuthClientId)
      ) {
        log.debug('getStoredToken: dropping token with mismatched audience', {
          key,
          expectedClientId: expected.oAuthClientId,
          aud: claims.aud,
        });
        return undefined;
      }
    }

    return {
      accessToken: entry.OAuthAccessToken,
      idToken: entry.OAuthIdToken,
      refreshToken: entry.OAuthRefreshToken,
      expiresAt: entry.OAuthExpiresAt,
    };
  };

  if (userId) {
    return findToken(userKey(userId, zone));
  }

  // Try all stored users for the requested zone. Filtering by zone is what
  // makes `/region` switches actually re-authenticate against the new data
  // center: without it, a stored US token would be returned for an EU lookup
  // (since both `User-…` and `User[eu]-…` pass the generic `isUserKey` test),
  // and `performAmplitudeAuth` would skip the browser entirely.
  for (const key of Object.keys(config)) {
    if (!isUserKeyForZone(key, zone)) continue;
    const token = findToken(key);
    if (token) return token;
  }
  return undefined;
}

/** Persists OAuth tokens to the wizard session store (and legacy mirror). */
export function storeToken(
  user: StoredUser,
  token: StoredOAuthToken,
  configPath?: string,
): void {
  const config = readConfig(configPath);
  const key = userKey(user.id, user.zone);
  config[key] = {
    ...((config[key] as object | undefined) ?? {}),
    User: user,
    OAuthAccessToken: token.accessToken,
    OAuthIdToken: token.idToken,
    OAuthRefreshToken: token.refreshToken,
    OAuthExpiresAt: token.expiresAt,
  };
  writeConfig(config, configPath);
}

/** Persists a user + token as the sole stored account, wiping any prior User entries. */
export function replaceStoredUser(
  user: StoredUser,
  token: StoredOAuthToken,
  configPath?: string,
): void {
  const config = readConfig(configPath);
  const wiped: string[] = [];
  for (const k of Object.keys(config)) {
    if (isUserKey(k)) {
      delete config[k];
      wiped.push(k);
    }
  }
  if (wiped.length > 0) {
    log.debug('replaceStoredUser: wiped prior user entries', {
      count: wiped.length,
      keys: wiped,
    });
  }
  const key = userKey(user.id, user.zone);
  // No spread needed: the loop above deleted every User-* key, so there is
  // nothing to preserve at `config[key]`.
  config[key] = {
    User: user,
    OAuthAccessToken: token.accessToken,
    OAuthIdToken: token.idToken,
    OAuthRefreshToken: token.refreshToken,
    OAuthExpiresAt: token.expiresAt,
  };
  writeConfig(config, configPath);
}

/** Clears all stored credentials by writing an empty config. */
export function clearStoredCredentials(configPath?: string): void {
  writeConfig({}, configPath);
}

// ── Wizard-scoped settings namespace ──────────────────────────────────
//
// Reserved top-level keys use the `User-*` prefix for OAuth entries.
// Wizard-only settings live under the `wizard` key.

const WizardNamespaceSchema = z
  .object({
    lastUsedOrgId: z.string().optional(),
    lastUsedWorkspaceId: z.string().optional(),
    // Matches `selectedAppId` on the wizard session — both refer to the
    // numeric Amplitude app/environment id. Keep the terminology in sync
    // so a future caller doesn't reintroduce the retired `project` term.
    lastUsedAppId: z.string().optional(),
  })
  .passthrough();

type WizardNamespace = z.infer<typeof WizardNamespaceSchema>;

function readWizardNamespace(configPath?: string): WizardNamespace {
  const config = readConfig(configPath);
  const parsed = WizardNamespaceSchema.safeParse(config['wizard'] ?? {});
  return parsed.success ? parsed.data : {};
}

function writeWizardNamespace(
  next: WizardNamespace,
  configPath?: string,
): void {
  const config = readConfig(configPath);
  config['wizard'] = next;
  writeConfig(config, configPath);
}

/**
 * Returns the last-used org/workspace/app selection triple. Each field is
 * individually optional — a user who has never had a workspace picked can
 * still have an orgId from an org-only run.
 *
 * Field naming matches the canonical session shape (`selectedAppId`,
 * `selectedWorkspaceId`, `selectedOrgId`) so callers can spread directly
 * into the picker pre-focus logic without re-keying.
 */
export function getLastUsedSelection(configPath?: string): {
  orgId?: string;
  workspaceId?: string;
  appId?: string;
} {
  const ns = readWizardNamespace(configPath);
  return {
    orgId: ns.lastUsedOrgId,
    workspaceId: ns.lastUsedWorkspaceId,
    appId: ns.lastUsedAppId,
  };
}

/**
 * Persist the last-used selection triple. Pass undefined to clear a level
 * (e.g. when the user selects a different org, the old workspace/app
 * shouldn't pre-focus the picker anymore). Other wizard-scoped settings
 * inside the `wizard` namespace are preserved.
 */
export function storeLastUsedSelection(
  selection: {
    orgId?: string;
    workspaceId?: string;
    appId?: string;
  },
  configPath?: string,
): void {
  const current = readWizardNamespace(configPath);
  writeWizardNamespace(
    {
      ...current,
      lastUsedOrgId: selection.orgId,
      lastUsedWorkspaceId: selection.workspaceId,
      lastUsedAppId: selection.appId,
    },
    configPath,
  );
}

/**
 * Updates the stored user's zone in the session store, migrating the entry to the
 * new zone key. Returns the updated user, or undefined if no user is stored.
 */
export function updateStoredUserZone(
  newZone: AmplitudeZone,
  configPath?: string,
): StoredUser | undefined {
  const user = getStoredUser(configPath);
  if (!user) return undefined;

  const config = readConfig(configPath);
  const oldKey = userKey(user.id, user.zone);
  const newKey = userKey(user.id, newZone);
  const entry = config[oldKey];

  if (entry !== undefined) {
    if (oldKey !== newKey) {
      delete config[oldKey];
    }
    config[newKey] = {
      ...(entry as object),
      User: { ...user, zone: newZone },
    };
  }

  writeConfig(config, configPath);
  return { ...user, zone: newZone };
}
