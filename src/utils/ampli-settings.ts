/**
 * Reads and writes OAuth tokens from/to ~/.ampli.json, the same file used by
 * the ampli CLI. This lets users who are already logged in via `ampli login`
 * skip re-authenticating in the wizard.
 *
 * The ampli CLI stores tokens using the `conf` package (v6) with
 * accessPropertiesByDotNotation:true, which nests keys by dot segments:
 *   "User-{userId}.OAuthAccessToken" → { "User-{userId}": { "OAuthAccessToken": "..." } }
 */
/**
 * Note: user-entry migration helpers were rewritten from a more implicit
 * version into explicit key-selection flow for clearer semantics.
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

const StoredEntrySchema = z
  .object({
    User: StoredUserSchema.optional(),
    OAuthAccessToken: z.string().optional(),
    OAuthIdToken: z.string().optional(),
    OAuthRefreshToken: z.string().optional(),
    OAuthExpiresAt: z.string().optional(),
  })
  .passthrough();

interface StoredUserUpdatePlan {
  existingEntryKey: string;
  shouldDropPending: boolean;
}

function resolveStoredUserUpdatePlan(
  config: Record<string, unknown>,
  pendingKey: string,
  realKey: string,
): StoredUserUpdatePlan | undefined {
  const shouldDropPending =
    pendingKey !== realKey && config[pendingKey] !== undefined;

  if (config[pendingKey] !== undefined) {
    return {
      existingEntryKey: pendingKey,
      shouldDropPending,
    };
  }
  if (config[realKey] !== undefined) {
    return {
      existingEntryKey: realKey,
      shouldDropPending,
    };
  }
  return undefined;
}

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

  // Try all stored users
  for (const key of Object.keys(config)) {
    if (!key.startsWith('User-') && !key.startsWith('User[')) continue;
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

/**
 * Updates the stored User record without touching OAuth token fields.
 * Migrates a pending-sentinel entry to the real-id key while preserving the
 * OAuth* fields written earlier by performAmplitudeAuth / performSignupOrAuth.
 */
export function updateStoredUser(user: StoredUser, configPath?: string): void {
  const config = readConfig(configPath);
  const pendingKey = userKey('pending', user.zone);
  const realKey = userKey(user.id, user.zone);
  const updatePlan = resolveStoredUserUpdatePlan(config, pendingKey, realKey);
  if (!updatePlan) return;

  const { existingEntryKey, shouldDropPending } = updatePlan;

  // Guard against malformed disk state before spreading fields into a new object.
  const parsedEntry = StoredEntrySchema.safeParse(config[existingEntryKey]);
  if (!parsedEntry.success) return;

  // If we are migrating from pending -> real key, drop the pending record.
  if (shouldDropPending) {
    delete config[pendingKey];
  }

  // Preserve OAuth* fields from the existing entry while replacing the User payload.
  config[realKey] = {
    ...parsedEntry.data,
    User: user,
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

  const parsed = StoredEntrySchema.safeParse(config[oldKey]);
  if (!parsed.success) {
    // Nothing valid to migrate — preserve prior contract of returning the
    // updated user (the write was a no-op in this case anyway).
    return { ...user, zone: newZone };
  }

  const withoutOld = Object.fromEntries(
    Object.entries(config).filter(([k]) => k !== oldKey),
  );
  writeConfig(
    {
      ...withoutOld,
      [newKey]: { ...parsed.data, User: { ...user, zone: newZone } },
    },
    configPath,
  );
  return { ...user, zone: newZone };
}
