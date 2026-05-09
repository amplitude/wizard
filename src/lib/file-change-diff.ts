/**
 * file-change-diff — read-only adapter that turns the canonical
 * {@link FileChangeLedger} entries (`beforeContent` / `afterContent`)
 * into the diff shape the TUI's DiffViewer + the agent-mode
 * `file_changed` NDJSON event consume.
 *
 * The ledger itself (see `file-change-ledger.ts`) is owned by the
 * cancel-rollback path — its public shape is intentionally minimal
 * (`FileChangeEntry`, `getEntries()`). This module is the single place
 * that knows how to turn that shape into unified diffs / additions /
 * deletions / hunk metadata, so the ledger stays focused on rollback
 * correctness.
 *
 * All helpers here are pure: no IO, no mutation of the ledger.
 */

import { createPatch, structuredPatch } from 'diff';
import { isAbsolute, resolve } from 'node:path';

import {
  type FileChangeEntry,
  type FileChangeKind,
  type FileChangeLedger,
} from './file-change-ledger.js';

/** Re-export the kind type so DiffViewer doesn't need to import the ledger. */
export type FileChangeOperation = FileChangeKind;

/** Lightweight per-hunk shape suitable for NDJSON emission. */
export interface DiffHunkLite {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

/** Result of computing a diff for a single file. */
export interface FileDiffSummary {
  path: string;
  operation: FileChangeOperation;
  additions: number;
  deletions: number;
  /** Unified-diff text. Empty when there is no textual change. */
  patch: string;
  hunks: DiffHunkLite[];
}

/**
 * Heuristic binary check: a NUL byte in the first 8kB. Mirrors the gate
 * the ledger applies at capture time so callers don't render diffs for
 * binaries that the ledger may have stored as null content.
 */
export function isProbablyBinary(content: string): boolean {
  const sliceLen = Math.min(content.length, 8192);
  for (let i = 0; i < sliceLen; i++) {
    if (content.charCodeAt(i) === 0) return true;
  }
  return false;
}

/**
 * Compute additions / deletions / hunks from a structured patch. Pure so
 * tests can validate counts independent of jsdiff internals leaking.
 */
export function summarizeDiff(
  before: string,
  after: string,
): { additions: number; deletions: number; hunks: DiffHunkLite[] } {
  if (before === after) {
    return { additions: 0, deletions: 0, hunks: [] };
  }
  const sp = structuredPatch('a', 'b', before, after, '', '', { context: 3 });
  let additions = 0;
  let deletions = 0;
  const hunks: DiffHunkLite[] = [];
  for (const h of sp.hunks) {
    hunks.push({
      oldStart: h.oldStart,
      oldLines: h.oldLines,
      newStart: h.newStart,
      newLines: h.newLines,
    });
    for (const line of h.lines) {
      if (line.startsWith('+')) additions++;
      else if (line.startsWith('-')) deletions++;
    }
  }
  return { additions, deletions, hunks };
}

/**
 * Options for {@link summarizeLedgerEntry}. Hot-path callers (PostToolUse
 * inner-lifecycle hook, FileWritesPanel toast) only consume
 * additions/deletions/hunks and never render the unified-patch text — they
 * can pass `includePatch: false` to skip the redundant `createPatch` call,
 * which runs the same O(n·m) diff a second time. Defaults to true so the
 * outro / DiffViewer / `/diff` paths keep the patch body.
 */
export interface SummarizeLedgerEntryOptions {
  includePatch?: boolean;
}

/**
 * Build a {@link FileDiffSummary} from one ledger entry. Returns `null`
 * when the entry has no captured content on either side (binary, IO
 * error during capture) — callers should skip those silently.
 *
 * Also returns `null` when one side of the capture failed (e.g. PostToolUse
 * couldn't re-read the file) and the other side has content. Without this
 * guard, the missing side would default to `''` and every line of the
 * captured side would render as deletions or additions — a misleading
 * "huge change" toast for what is actually a capture failure.
 */
export function summarizeLedgerEntry(
  entry: FileChangeEntry,
  options: SummarizeLedgerEntryOptions = {},
): FileDiffSummary | null {
  const { includePatch = true } = options;
  // No content captured on either side: nothing to render.
  if (entry.beforeContent === null && entry.afterContent === null) {
    return null;
  }
  // One-sided capture failure: surface as "no diff" rather than treat the
  // missing side as `''`, which would falsely render every captured line
  // as added/removed. Exception: legitimate `create` (no before, has after)
  // and `delete` (has before, no after) ARE one-sided by construction —
  // those are the ledger's `kind` and we trust them.
  if (entry.beforeContent === null && entry.kind !== 'create') return null;
  if (entry.afterContent === null && entry.kind !== 'delete') return null;
  const before = entry.beforeContent ?? '';
  const after = entry.afterContent ?? '';
  // Skip binary content — the ledger stores it as a string but the diff
  // would balloon memory and produce noise.
  if (
    (entry.beforeContent !== null && isProbablyBinary(before)) ||
    (entry.afterContent !== null && isProbablyBinary(after))
  ) {
    return null;
  }
  const { additions, deletions, hunks } = summarizeDiff(before, after);
  // `createPatch` re-runs the same O(n·m) diff `structuredPatch` already
  // did — only call it when the caller actually needs the patch text.
  const patch = !includePatch
    ? ''
    : before === after
    ? ''
    : createPatch(entry.path, before, after, '', '', { context: 3 });
  return {
    path: entry.path,
    operation: entry.kind,
    additions,
    deletions,
    patch,
    hunks,
  };
}

/**
 * Walk every entry in the ledger and produce the diff summaries the
 * outro / `/diff` command consume. Order matches the ledger's own
 * insertion order (chronological by first PreToolUse capture). Skips
 * entries where {@link summarizeLedgerEntry} returns null.
 *
 * `options` is forwarded to {@link summarizeLedgerEntry} so summary-only
 * callers (e.g. the `/diff` summary command, which only renders +/-
 * counts and never reads the patch body) can pass `{ includePatch: false }`
 * and skip the redundant `createPatch` call per entry.
 */
export function summarizeLedgerDiffs(
  ledger: FileChangeLedger | null,
  options: SummarizeLedgerEntryOptions = {},
): FileDiffSummary[] {
  if (!ledger) return [];
  const out: FileDiffSummary[] = [];
  for (const entry of ledger.getEntries()) {
    const summary = summarizeLedgerEntry(entry, options);
    if (summary) out.push(summary);
  }
  return out;
}

/**
 * Find the most recent ledger entry for a given path and return its
 * diff summary. Returns `null` when no entry exists for that path or
 * when the entry has no diffable content. Used by the per-file
 * `file_changed` NDJSON emission and `/diff <path>`.
 *
 * The lookup path is normalized the same way the ledger normalized it
 * during capture (`resolve()` against the install dir). Without this,
 * a relative or `..`-bearing tool-input path would silently miss the
 * lookup — the ledger stored `<installDir>/foo.ts` but the lookup key
 * is the raw `foo.ts`, and `===` comparison fails.
 *
 * `options` is forwarded to {@link summarizeLedgerEntry} so hot-path
 * callers (PostToolUse) can pass `{ includePatch: false }` to skip the
 * redundant `createPatch` call.
 */
export function summarizeLedgerPath(
  ledger: FileChangeLedger | null,
  rawPath: string,
  options?: SummarizeLedgerEntryOptions,
): FileDiffSummary | null {
  if (!ledger) return null;
  const installDir = ledger.getInstallDir();
  const normalized = isAbsolute(rawPath)
    ? resolve(rawPath)
    : resolve(installDir, rawPath);
  // Walk in reverse so we pick up the latest capture for a path that's
  // been written more than once. Mirrors how the ledger's own
  // `findActive` lookup works.
  const entries = ledger.getEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].path === normalized) {
      return summarizeLedgerEntry(entries[i], options);
    }
  }
  return null;
}
