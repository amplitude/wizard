/**
 * Reads and writes OAuth tokens from/to ~/.ampli.json, the same file used by
 * the ampli CLI. This lets users who are already logged in via `ampli login`
 * skip re-authenticating in the wizard.
 *
 * The ampli CLI stores tokens using the `conf` package (v6) with
 * accessPropertiesByDotNotation:true, which nests keys by dot segments:
 *   "User-{userId}.OAuthAccessToken" → { "User-{userId}": { "OAuthAccessToken": "..." } }
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { z } from 'zod';
import {
  type AmplitudeZone,
  DEFAULT_AMPLITUDE_ZONE,
} from '../lib/constants.js';
import { createLogger } from '../lib/observability/logger.js';
import { atomicWriteJSON } from './atomic-write.js';

const log = createLogger('ampli-settings');

export const AMPLI_CONFIG_PATH = path.join(os.homedir(), '.ampli.json');

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

function readConfig(configPath = AMPLI_CONFIG_PATH): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const result = AmpliSettingsFileSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}

function writeConfig(
  data: Record<string, unknown>,
  configPath = AMPLI_CONFIG_PATH,
): void {
  // Atomic write: temp file + rename prevents corruption if process dies mid-write
  atomicWriteJSON(configPath, data, 0o600);
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
 * True iff a given ~/.ampli.json key belongs to the requested zone.
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

/** Persists an OAuth token to ~/.ampli.json in the same format as the ampli CLI. */
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
// `~/.ampli.json` is shared with the ampli CLI; reserved keys at the top
// level are owned by ampli (User-*, etc.). Wizard-only settings live under
// the `wizard` key so we never collide with ampli's schema.

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
 * Updates the stored user's zone in ~/.ampli.json, migrating the entry to the
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
