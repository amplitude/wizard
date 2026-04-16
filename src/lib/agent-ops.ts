/**
 * agent-ops — Pure business logic for agent-mode verbs.
 *
 * These functions power `amplitude-wizard detect | status | auth token | auth status`.
 * They return serializable data so thin CLI wrappers can emit JSON (for agents)
 * or format for humans with the same underlying source of truth.
 *
 * No UI, no process.exit, no console.log — keeps the logic testable and reusable
 * from both the CLI and the future external MCP server.
 */

import { detectAllFrameworks } from '../run';
import {
  detectAmplitudeInProject,
  type AmplitudeDetectionResult,
} from './detect-amplitude';
import { readApiKeyWithSource } from '../utils/api-key-store';
import {
  getStoredUser,
  getStoredToken,
  type StoredUser,
} from '../utils/ampli-settings';
import { FRAMEWORK_REGISTRY } from './registry';
import { Integration } from './constants';

// ── detect ──────────────────────────────────────────────────────────

export interface DetectResult {
  integration: Integration | null;
  frameworkName: string | null;
  confidence: 'detected' | 'none';
  signals: Array<{
    integration: Integration;
    detected: boolean;
    durationMs: number;
    timedOut: boolean;
    error?: string;
  }>;
}

export async function runDetect(installDir: string): Promise<DetectResult> {
  const results = await detectAllFrameworks(installDir);
  const hit = results.find((r) => r.detected);
  const integration = hit?.integration ?? null;
  const frameworkName = integration
    ? FRAMEWORK_REGISTRY[integration].metadata.name
    : null;
  return {
    integration,
    frameworkName,
    confidence: integration ? 'detected' : 'none',
    signals: results.map(
      ({ integration, detected, durationMs, timedOut, error }) => ({
        integration,
        detected,
        durationMs,
        timedOut,
        ...(error ? { error } : {}),
      }),
    ),
  };
}

// ── status ──────────────────────────────────────────────────────────

export interface StatusResult {
  installDir: string;
  framework: {
    integration: Integration | null;
    name: string | null;
  };
  amplitudeInstalled: AmplitudeDetectionResult;
  apiKey: {
    configured: boolean;
    source: 'keychain' | 'env' | null;
  };
  auth: {
    loggedIn: boolean;
    email: string | null;
    zone: string | null;
  };
}

export async function runStatus(installDir: string): Promise<StatusResult> {
  const [detect, amplitudeInstalled] = await Promise.all([
    runDetect(installDir),
    Promise.resolve(detectAmplitudeInProject(installDir)),
  ]);

  const apiKey = readApiKeyWithSource(installDir);
  const user = getStoredUser();
  const hasToken = user ? Boolean(getStoredToken(user.id, user.zone)) : false;

  return {
    installDir,
    framework: {
      integration: detect.integration,
      name: detect.frameworkName,
    },
    amplitudeInstalled,
    apiKey: {
      configured: Boolean(apiKey),
      source: apiKey?.source ?? null,
    },
    auth: {
      loggedIn: Boolean(user && hasToken && user.id !== 'pending'),
      email: user?.email ?? null,
      zone: user?.zone ?? null,
    },
  };
}

// ── auth token ──────────────────────────────────────────────────────

export interface AuthTokenResult {
  token: string | null;
  expiresAt: string | null;
  zone: string | null;
}

export function getAuthToken(): AuthTokenResult {
  const user = getStoredUser();
  if (!user || user.id === 'pending') {
    return { token: null, expiresAt: null, zone: null };
  }
  const stored = getStoredToken(user.id, user.zone);
  if (!stored) {
    return { token: null, expiresAt: null, zone: user.zone };
  }
  return {
    token: stored.accessToken,
    expiresAt: stored.expiresAt,
    zone: user.zone,
  };
}

// ── auth status ─────────────────────────────────────────────────────

export interface AuthStatusResult {
  loggedIn: boolean;
  user: Pick<StoredUser, 'email' | 'firstName' | 'lastName' | 'zone'> | null;
  tokenExpiresAt: string | null;
}

export function getAuthStatus(): AuthStatusResult {
  const user = getStoredUser();
  if (!user || user.id === 'pending') {
    return { loggedIn: false, user: null, tokenExpiresAt: null };
  }
  const stored = getStoredToken(user.id, user.zone);
  return {
    loggedIn: Boolean(stored),
    user: {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      zone: user.zone,
    },
    tokenExpiresAt: stored?.expiresAt ?? null,
  };
}
