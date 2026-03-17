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
import {
  type AmplitudeZone,
  DEFAULT_AMPLITUDE_ZONE,
} from '../lib/constants.js';

export const AMPLI_CONFIG_PATH = path.join(os.homedir(), 'ampli.json');

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

function readConfig(configPath = AMPLI_CONFIG_PATH): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeConfig(
  data: Record<string, unknown>,
  configPath = AMPLI_CONFIG_PATH,
): void {
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf-8');
}

function userKey(userId: string, zone: AmplitudeZone): string {
  const safeId = userId.replace(/\./g, '-');
  return zone !== DEFAULT_AMPLITUDE_ZONE
    ? `User[${zone}]-${safeId}`
    : `User-${safeId}`;
}

/** Returns the first stored user, or undefined if none. */
export function getStoredUser(configPath?: string): StoredUser | undefined {
  const config = readConfig(configPath);
  for (const [key, value] of Object.entries(config)) {
    if (!key.startsWith('User-') && !key.startsWith('User[')) continue;
    const entry = value as Record<string, unknown>;
    if (entry.User) return entry.User as StoredUser;
  }
  return undefined;
}

/** Returns a valid (non-expired) stored token, or undefined. */
export function getStoredToken(
  userId?: string,
  zone: AmplitudeZone = DEFAULT_AMPLITUDE_ZONE,
  configPath?: string,
): StoredOAuthToken | undefined {
  const config = readConfig(configPath);

  const findToken = (key: string): StoredOAuthToken | undefined => {
    const entry = config[key] as Record<string, string> | undefined;
    if (!entry) return undefined;
    const {
      OAuthAccessToken,
      OAuthIdToken,
      OAuthRefreshToken,
      OAuthExpiresAt,
    } = entry;
    if (
      !OAuthAccessToken ||
      !OAuthIdToken ||
      !OAuthRefreshToken ||
      !OAuthExpiresAt
    )
      return undefined;
    // Check if refresh token is still valid (refresh TTL = 365 days from access expiry)
    const expiresAt = new Date(OAuthExpiresAt);
    const refreshExpiry = new Date(
      expiresAt.getTime() + 364 * 24 * 60 * 60 * 1000,
    );
    if (new Date() > refreshExpiry) return undefined;
    return {
      accessToken: OAuthAccessToken,
      idToken: OAuthIdToken,
      refreshToken: OAuthRefreshToken,
      expiresAt: OAuthExpiresAt,
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

/** Clears all stored credentials by writing an empty config. */
export function clearStoredCredentials(configPath?: string): void {
  writeConfig({}, configPath);
}

/** Returns the stored snake high score, or 0 if none. */
export function getSnakeHighScore(configPath?: string): number {
  const config = readConfig(configPath);
  const score = config['snake_high_score'];
  return typeof score === 'number' ? score : 0;
}

/** Persists the snake high score to ~/.ampli.json. */
export function setSnakeHighScore(score: number, configPath?: string): void {
  const config = readConfig(configPath);
  config['snake_high_score'] = score;
  writeConfig(config, configPath);
}

function clampVol(v: unknown, def: number): number {
  return typeof v === 'number' ? Math.max(0, Math.min(1, v)) : def;
}

/** Returns the stored snake music (BGM) volume (0–1), defaulting to 0.8. */
export function getSnakeMusicVolume(configPath?: string): number {
  return clampVol(readConfig(configPath)['snake_music_volume'], 0.8);
}
/** Persists the snake music (BGM) volume to ~/.ampli.json. */
export function setSnakeMusicVolume(volume: number, configPath?: string): void {
  const config = readConfig(configPath);
  config['snake_music_volume'] = Math.max(0, Math.min(1, volume));
  writeConfig(config, configPath);
}

/** Returns the stored snake tink (per-frame) volume (0–1), defaulting to 0.05. */
export function getSnakeTinkVolume(configPath?: string): number {
  return clampVol(readConfig(configPath)['snake_tink_volume'], 0.05);
}
/** Persists the snake tink volume to ~/.ampli.json. */
export function setSnakeTinkVolume(volume: number, configPath?: string): void {
  const config = readConfig(configPath);
  config['snake_tink_volume'] = Math.max(0, Math.min(1, volume));
  writeConfig(config, configPath);
}

/** Returns the stored snake SFX (eat/die) volume (0–1), defaulting to 0.8. */
export function getSnakeSfxVolume(configPath?: string): number {
  return clampVol(readConfig(configPath)['snake_sfx_volume'], 0.8);
}
/** Persists the snake SFX volume to ~/.ampli.json. */
export function setSnakeSfxVolume(volume: number, configPath?: string): void {
  const config = readConfig(configPath);
  config['snake_sfx_volume'] = Math.max(0, Math.min(1, volume));
  writeConfig(config, configPath);
}
