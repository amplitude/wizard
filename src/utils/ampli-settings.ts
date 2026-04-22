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
import { atomicWriteJSON } from './atomic-write.js';

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

const StoredUserSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  zone: z.string(),
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
    if (!key.startsWith('User-') && !key.startsWith('User[')) continue;
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

  // Validates `OAuthExpiresAt` as an ISO-8601 datetime. If the stored value
  // is malformed (hand-edited ampli.json, older broken writer, etc.), fall
  // back to a 1-hour-from-now ISO date — the same default value callers
  // used to fabricate before `expiresAt` was threaded through the auth
  // result. This keeps token-refresh math from seeing NaN and makes the
  // downstream behavior no worse than the pre-PR baseline.
  const OAuthEntrySchema = z
    .object({
      OAuthAccessToken: z.string(),
      OAuthIdToken: z.string(),
      OAuthRefreshToken: z.string(),
      OAuthExpiresAt: z
        .string()
        .datetime()
        .catch(() => new Date(Date.now() + 3600 * 1000).toISOString()),
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

  // Try all stored users
  for (const key of Object.keys(config)) {
    if (!key.startsWith('User-') && !key.startsWith('User[')) continue;
    const token = findToken(key);
    if (token) return token;
  }
  return undefined;
}

/**
 * Persists an OAuth token to ~/.ampli.json in the same format as the ampli CLI.
 *
 * When writing a non-pending user, any sibling `{id:'pending'}` entry for the
 * same zone is cleaned up. That entry is only ever written as a transient
 * crash-recovery sentinel (see `performSignupOrAuth`'s failure branch); once
 * the caller has a real user, the sentinel is obsolete and would otherwise
 * linger as orphan state and risk returning stale tokens from a no-userId
 * `getStoredToken()` lookup.
 */
export function storeToken(
  user: StoredUser,
  token: StoredOAuthToken,
  configPath?: string,
): void {
  const config = readConfig(configPath);
  const key = userKey(user.id, user.zone);
  if (user.id !== 'pending') {
    delete config[userKey('pending', user.zone)];
  }
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

/** Clears all stored credentials by writing an empty config. */
export function clearStoredCredentials(configPath?: string): void {
  writeConfig({}, configPath);
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
