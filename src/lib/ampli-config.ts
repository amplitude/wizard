/**
 * Types and logic for the project-level ~/.ampli.json configuration file.
 *
 * The ampli CLI reads and writes this file (named "ampli.json") in the project
 * directory to track which Amplitude workspace, source, and branch a project is
 * connected to. The wizard creates or updates this file during setup.
 *
 * Types are modelled after the ampli CLI's Settings class
 * (ampli/src/settings/index.ts) and are intentionally kept compatible.
 *
 * UNIT-TESTABLE SURFACE (pure, no I/O):
 *   parseAmpliConfig, validateAmpliConfig, mergeAmpliConfig,
 *   isConfigured, isMinimllyConfigured
 *
 * I/O SURFACE (not unit-testable in isolation):
 *   readAmpliConfig, writeAmpliConfig, ampliConfigExists
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AmplitudeZone } from './constants.js';

export const AMPLI_CONFIG_FILENAME = 'ampli.json';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * The shape of a project-level ampli.json file.
 * All fields are optional because the file may be partially initialised.
 */
export interface AmpliConfig {
  /** UUID of the Amplitude organization */
  OrgId?: string;
  /** UUID of the Amplitude workspace */
  WorkspaceId?: string;
  /** UUID of the data source (tracking plan source) */
  SourceId?: string;
  /** Branch name in the tracking plan (e.g. "main") */
  Branch?: string;
  /** Path where the generated Ampli SDK lives (e.g. "./src/ampli") */
  Path?: string;
  /** Semantic version of the current tracking plan (e.g. "42.0.0") */
  Version?: string;
  /** UUID identifying the current tracking plan version */
  VersionId?: string;
  /** Amplitude data zone ("us" | "eu") */
  Zone?: AmplitudeZone;
  /** Runtime code as used by the ampli CLI (e.g. "node.js:typescript-ampli") */
  Runtime?: string;
  /** Platform display name (e.g. "Node.js") */
  Platform?: string;
  /** Language display name (e.g. "TypeScript") */
  Language?: string;
  /** SDK package specifier (e.g. "@amplitude/analytics-node@^1.0") */
  SDK?: string;
  /** When true, generated code omits API keys */
  OmitApiKeys?: boolean;
  /** Source directories to scan for Ampli usage */
  SourceDirs?: string[];
  /** Named Amplitude SDK instances to generate */
  InstanceNames?: string[];
}

export type AmpliConfigParseResult =
  | { ok: true; config: AmpliConfig }
  | { ok: false; error: 'not_found' | 'invalid_json' | 'merge_conflicts' };

// ── Pure logic (unit-testable) ────────────────────────────────────────────────

/**
 * Parse a raw JSON string into an AmpliConfig.
 * Returns a typed result rather than throwing.
 */
export function parseAmpliConfig(raw: string): AmpliConfigParseResult {
  if (hasMergeConflicts(raw)) {
    return { ok: false, error: 'merge_conflicts' };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { ok: false, error: 'invalid_json' };
    }
    return { ok: true, config: parsed as AmpliConfig };
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
}

/**
 * Returns true when the config contains the fields required to query Amplitude
 * for event data (i.e. the project has been linked to an Amplitude source).
 */
export function isMinimallyConfigured(config: AmpliConfig): boolean {
  return Boolean(config.SourceId);
}

/**
 * Returns true when the config is considered fully configured: it has an org,
 * a workspace, and a source linked.
 */
export function isConfigured(config: AmpliConfig): boolean {
  return Boolean(config.OrgId && config.WorkspaceId && config.SourceId);
}

/**
 * Shallow-merge an update into an existing config. Undefined update values are
 * ignored so callers can safely spread partial objects.
 */
export function mergeAmpliConfig(
  existing: AmpliConfig,
  updates: Partial<AmpliConfig>,
): AmpliConfig {
  const result: AmpliConfig = { ...existing };
  for (const [key, value] of Object.entries(updates) as [
    keyof AmpliConfig,
    AmpliConfig[keyof AmpliConfig],
  ][]) {
    if (value !== undefined) {
      // @ts-expect-error – dynamic key assignment
      result[key] = value;
    }
  }
  return result;
}

/**
 * Detect git merge conflict markers in a file's content.
 * Mirrors the check in the ampli CLI (ampli/src/util/git/mergeConflicts.ts).
 */
export function hasMergeConflicts(text: string): boolean {
  return (
    text.includes('<<<<<<<') &&
    text.includes('=======') &&
    text.includes('>>>>>>>')
  );
}

// ── I/O (not unit-testable in isolation) ────────────────────────────────────

/**
 * Returns the full path to ampli.json in the given directory.
 */
export function ampliConfigPath(dir: string): string {
  return path.join(dir, AMPLI_CONFIG_FILENAME);
}

/**
 * Returns true if ampli.json exists in the given directory.
 */
export function ampliConfigExists(dir: string): boolean {
  return fs.existsSync(ampliConfigPath(dir));
}

/**
 * Read and parse ampli.json from the given directory.
 * Returns a typed result; never throws.
 */
export function readAmpliConfig(dir: string): AmpliConfigParseResult {
  const filePath = ampliConfigPath(dir);
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return { ok: false, error: 'not_found' };
  }
  return parseAmpliConfig(raw);
}

/**
 * Write an AmpliConfig object to ampli.json in the given directory.
 * Creates the directory if it does not exist.
 */
export function writeAmpliConfig(dir: string, config: AmpliConfig): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    ampliConfigPath(dir),
    JSON.stringify(config, null, 2),
    'utf-8',
  );
}
