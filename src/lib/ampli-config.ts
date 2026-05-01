/**
 * Types and logic for the wizard's project-level Amplitude binding.
 *
 * The canonical on-disk location is `<installDir>/.amplitude/project-binding.json`.
 * Legacy `ampli.json` in the project root remains readable (and is written
 * during transition) for older workflows.
 *
 * UNIT-TESTABLE SURFACE (pure, no I/O):
 *   parseAmpliConfig, validateAmpliConfig, mergeAmpliConfig,
 *   isConfigured, isMinimllyConfigured
 *
 * I/O SURFACE:
 *   readAmpliConfig, writeAmpliConfig, ampliConfigExists
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import type { AmplitudeZone } from './constants.js';
import { atomicWriteJSON } from '../utils/atomic-write.js';
import {
  ensureDir,
  getProjectBindingFile,
  getProjectMetaDir,
} from '../utils/storage-paths.js';
import { createLogger } from './observability/logger.js';

const log = createLogger('ampli-config');

export const AMPLI_CONFIG_FILENAME = 'ampli.json';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * The shape of a project-level ampli.json file.
 * All fields are optional because the file may be partially initialised.
 */
export interface AmpliConfig {
  /** UUID of the Amplitude organization */
  OrgId?: string;
  /** UUID of the Amplitude project (formerly "workspace") */
  ProjectId?: string;
  /** @deprecated use ProjectId — kept for read-time back-compat migration */
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
  /**
   * Numeric Amplitude app id (a.k.a. "Project ID" in the Amplitude UI).
   * Stored as a string for forward compat with non-numeric ids and
   * because JSON has no integer-vs-string distinction at this scale.
   * Persisted by the wizard at the end of a successful run so a follow-up
   * agent session can read it back without re-running env selection —
   * the source of truth for "which Amplitude app does this codebase
   * write events into."
   */
  AppId?: string;
  /** Display name for `AppId`. Diagnostic only — `AppId` is the join key. */
  AppName?: string;
  /** Amplitude environment label that `AppId` resolved against (Production/Dev/etc). */
  EnvName?: string;
  /** Last dashboard URL the wizard created during this codebase's setup. */
  DashboardUrl?: string;
  /** Convenience id parsed from `DashboardUrl`. */
  DashboardId?: string;
}

export type AmpliConfigParseResult =
  | { ok: true; config: AmpliConfig }
  | { ok: false; error: 'not_found' | 'invalid_json' | 'merge_conflicts' };

// ── Pure logic (unit-testable) ────────────────────────────────────────────────

const AmpliConfigSchema = z
  .object({
    OrgId: z.string().optional(),
    ProjectId: z.string().optional(),
    // Kept readable for back-compat with ampli.json files written before the
    // workspace → project rename. parseAmpliConfig migrates it to ProjectId
    // at the read boundary; everything downstream only sees ProjectId.
    WorkspaceId: z.string().optional(),
    SourceId: z.string().optional(),
    Branch: z.string().optional(),
    Path: z.string().optional(),
    Version: z.string().optional(),
    VersionId: z.string().optional(),
    Zone: z.string().optional(),
    Runtime: z.string().optional(),
    Platform: z.string().optional(),
    Language: z.string().optional(),
    SDK: z.string().optional(),
    OmitApiKeys: z.boolean().optional(),
    SourceDirs: z.array(z.string()).optional(),
    InstanceNames: z.array(z.string()).optional(),
    AppId: z.string().optional(),
    AppName: z.string().optional(),
    EnvName: z.string().optional(),
    DashboardUrl: z.string().optional(),
    DashboardId: z.string().optional(),
  })
  .passthrough();

/**
 * Parse a raw JSON string into an AmpliConfig.
 * Returns a typed result rather than throwing.
 *
 * Read-time migration: if a legacy `WorkspaceId` field is present and the new
 * `ProjectId` is absent, the value is copied to `ProjectId` and `WorkspaceId`
 * is dropped from the returned object. When both are present, `ProjectId`
 * wins. This keeps the rest of the codebase unaware of the legacy key;
 * `writeAmpliConfig` only ever emits `ProjectId`, so files auto-migrate on
 * the user's next save.
 */
export function parseAmpliConfig(raw: string): AmpliConfigParseResult {
  if (hasMergeConflicts(raw)) {
    return { ok: false, error: 'merge_conflicts' };
  }
  try {
    const result = AmpliConfigSchema.safeParse(JSON.parse(raw));
    if (!result.success) {
      return { ok: false, error: 'invalid_json' };
    }
    const config = { ...result.data } as AmpliConfig;
    if (config.WorkspaceId && !config.ProjectId) {
      config.ProjectId = config.WorkspaceId;
    }
    delete config.WorkspaceId;
    return { ok: true, config };
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
 * a project, and a source linked.
 */
export function isConfigured(config: AmpliConfig): boolean {
  return Boolean(config.OrgId && config.ProjectId && config.SourceId);
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
  return (
    fs.existsSync(getProjectBindingFile(dir)) ||
    fs.existsSync(ampliConfigPath(dir))
  );
}

/**
 * Read and parse a single binding JSON file.
 * Returns a typed result; never throws.
 */
function readAmpliConfigFile(filePath: string): AmpliConfigParseResult {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      log.debug('readAmpliConfigFile: read failed', {
        path: filePath,
        'error message': err instanceof Error ? err.message : String(err),
      });
    }
    return { ok: false, error: 'not_found' };
  }
  return parseAmpliConfig(raw);
}

/**
 * Read project binding from `.amplitude/project-binding.json`, falling back to
 * legacy root `ampli.json`, merging when both exist (binding overrides).
 */
export function readAmpliConfig(dir: string): AmpliConfigParseResult {
  const bindingPath = getProjectBindingFile(dir);
  const legacyPath = ampliConfigPath(dir);
  const bindingResult = readAmpliConfigFile(bindingPath);
  const legacyResult = readAmpliConfigFile(legacyPath);

  let merged: AmpliConfig | undefined;

  if (legacyResult.ok) {
    merged = legacyResult.config;
  }
  if (bindingResult.ok) {
    merged = merged
      ? mergeAmpliConfig(merged, bindingResult.config)
      : bindingResult.config;
  }

  if (merged !== undefined) {
    if (
      legacyResult.ok &&
      !bindingResult.ok &&
      bindingResult.error === 'not_found'
    ) {
      try {
        ensureDir(getProjectMetaDir(dir));
        atomicWriteJSON(bindingPath, merged, 0o644);
      } catch (err) {
        log.debug('readAmpliConfig: could not migrate binding file forward', {
          'error message': err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { ok: true, config: merged };
  }

  if (
    !bindingResult.ok &&
    bindingResult.error === 'not_found' &&
    !legacyResult.ok &&
    legacyResult.error === 'not_found'
  ) {
    return { ok: false, error: 'not_found' };
  }
  if (!legacyResult.ok && legacyResult.error !== 'not_found') {
    return legacyResult;
  }
  if (!bindingResult.ok && bindingResult.error !== 'not_found') {
    return bindingResult;
  }
  return { ok: false, error: 'not_found' };
}

/**
 * Write an AmpliConfig to the canonical binding path and mirror to legacy
 * `ampli.json` for transition compatibility.
 *
 * @returns true if at least one destination was written successfully.
 */
export function writeAmpliConfig(dir: string, config: AmpliConfig): boolean {
  const bindingPath = getProjectBindingFile(dir);
  let anyOk = false;
  try {
    ensureDir(getProjectMetaDir(dir));
    atomicWriteJSON(bindingPath, config, 0o644);
    anyOk = true;
  } catch (err) {
    log.warn('writeAmpliConfig: canonical binding write failed', {
      'error message': err instanceof Error ? err.message : String(err),
    });
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      ampliConfigPath(dir),
      JSON.stringify(config, null, 2),
      'utf-8',
    );
    anyOk = true;
  } catch (err) {
    log.warn('writeAmpliConfig: legacy ampli.json write failed', {
      'error message': err instanceof Error ? err.message : String(err),
    });
  }
  return anyOk;
}

/**
 * Remove org/project/zone bindings from a project's ampli.json. Called on
 * logout so a subsequent login doesn't auto-select the previous user's org
 * and project. Tracking-plan fields (SourceId, Branch, Version, etc.) are
 * preserved — they're not auth state. No-op if ampli.json is missing or
 * malformed.
 *
 * Also deletes the legacy `WorkspaceId` field as a belt-and-suspenders
 * cleanup — parseAmpliConfig normalizes it away, but if the raw file still
 * carries it (e.g. someone edited it by hand), we strip it here too.
 */
export function clearAuthFieldsInAmpliConfig(dir: string): void {
  const result = readAmpliConfig(dir);
  if (!result.ok) return;
  const next: AmpliConfig = { ...result.config };
  delete next.OrgId;
  delete next.ProjectId;
  delete next.WorkspaceId;
  delete next.Zone;
  // The setup_complete fields below are also auth-scoped — they bind
  // the project to a specific Amplitude app/env that only exists in
  // the previously authenticated org. On logout, drop them so the
  // next sign-in starts from a clean scope. Tracking-plan fields
  // (SourceId, Branch, Version) survive — they belong to the project,
  // not the user.
  delete next.AppId;
  delete next.AppName;
  delete next.EnvName;
  delete next.DashboardUrl;
  delete next.DashboardId;
  writeAmpliConfig(dir, next);
}
