/**
 * file-change-ledger — track every file the agent writes so a cancelled
 * or errored run can revert the working tree to its pre-wizard state.
 *
 * The wizard's agent writes files (instrumentation, `.amplitude/` config,
 * `.gitignore` entries) as it works. When the run finishes successfully
 * those writes are intentional. When it cancels, errors, or the user hits
 * Ctrl+C, those partial writes pollute the user's repo — they have to
 * `git checkout -- .` and `rm -rf .amplitude/` to reset, which is exactly
 * the friction the wizard is supposed to hide.
 *
 * This module captures `{ path, beforeContent, afterContent, kind, ts }`
 * for each agent-driven write, and exposes a `rollback()` that reverses
 * the ledger in last-in-first-out order. The capture pairs with PreToolUse
 * (reads the existing on-disk content into `beforeContent`) and
 * PostToolUse (records `afterContent` once the write has actually
 * happened) hooks in `agent-interface.ts`.
 *
 * Design invariants:
 *
 *  - **Idempotent rollback.** Each entry is reverted at most once;
 *    calling `rollback()` twice is a no-op the second time. Necessary
 *    because both `wizardAbort()` and `agent-runner.ts`'s try/finally
 *    can fire on the same code path (e.g. cancel during a body throw).
 *  - **First-write wins for `beforeContent`.** If the agent writes the
 *    same path twice, the ledger keeps the ORIGINAL pre-wizard content,
 *    not the second write's "before" (which is just the first write's
 *    "after"). Reverting to the second write's "before" would leave the
 *    agent's first write on disk.
 *  - **Out-of-tree paths are ignored.** Only paths inside the install
 *    directory are tracked. The wizard's own state under
 *    `~/.amplitude/wizard/` is user-cache, not project-state, and must
 *    never be reverted.
 *  - **Atomic per-file.** Each rollback write goes through a temp-file
 *    + rename so a crash mid-rollback doesn't corrupt the destination.
 *  - **Best-effort.** Filesystem errors during capture or rollback are
 *    logged and swallowed. A failed rollback should never block exit.
 *
 * Shape coordination: this is the canonical implementation. The diff
 * viewer subagent's PR (in flight) consumes the same shape:
 *   { path, beforeContent, afterContent, kind, ts }
 * If their PR lands first, this module rebases on top of theirs without
 * shape changes. If this lands first, theirs rebases on top.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { logToFile } from '../utils/debug.js';

/**
 * Why a write happened, from the ledger's perspective.
 *
 *  - `create`: file did not exist on disk before the agent wrote it.
 *  - `modify`: file existed and the agent overwrote / edited it.
 *  - `delete`: file existed and the agent removed it (currently unused
 *    by the agent — Write/Edit/MultiEdit/NotebookEdit don't delete —
 *    but reserved for future Bash-driven `rm` capture).
 */
export type FileChangeKind = 'create' | 'modify' | 'delete';

/**
 * Canonical shape consumed by both the rollback path here and the diff
 * viewer subagent. Keep field names stable — both consumers walk this
 * shape directly.
 */
export interface FileChangeEntry {
  /** Absolute, normalised path. */
  path: string;
  /** File content before the agent touched it. `null` for `create`. */
  beforeContent: string | null;
  /** File content after the agent's write. `null` for `delete`. */
  afterContent: string | null;
  /** What the agent did to the file. */
  kind: FileChangeKind;
  /** Wall-clock millis when the entry was finalised (PostToolUse). */
  ts: number;
}

/**
 * Result returned by {@link FileChangeLedger.rollback}. The user-facing
 * cancel message concatenates the two counts:
 *
 *     "(N files reverted, M files removed.)"
 */
export interface RollbackResult {
  /** Number of `modify` / `delete` entries whose original content was rewritten. */
  filesReverted: number;
  /** Number of `create` entries whose newly-created file was deleted. */
  filesRemoved: number;
  /**
   * Paths the rollback could not revert (filesystem errors, permission
   * denied, etc.). Best-effort: a partial rollback is still better than
   * leaving every artifact behind.
   */
  failures: Array<{ path: string; reason: string }>;
}

/**
 * Optional extras the ledger captures alongside the per-tool entries so
 * directory-scoped artifacts (the `.amplitude/` config dir, the
 * `.gitignore` mutation) can be reverted as a unit.
 *
 * Why these aren't ordinary entries: the agent appends to `.gitignore`
 * via Edit, which the per-tool capture handles. But a SECOND wizard
 * write to `.gitignore` would clobber the original via first-write-wins
 * — these "preamble" snapshots cover the directory-level invariants the
 * per-write ledger can't express.
 */
interface PreambleSnapshot {
  /** Original `.gitignore` content (`null` if the file did not exist). */
  originalGitignore: string | null;
  /** True if the `.amplitude/` directory existed before the run. */
  amplitudeDirExistedBefore: boolean;
}

/**
 * Per-run mutable ledger. One instance per wizard attempt. Lifetime:
 * created in `runAgentWizard` (or equivalent entry point), threaded
 * through hook factories, consumed by the cancel path in
 * `wizardAbort()` / `agent-runner.ts`.
 */
export class FileChangeLedger {
  private readonly entries: FileChangeEntry[] = [];
  /**
   * Path → index in `entries`. Used by `recordPostWrite` to update an
   * earlier `recordPreWrite`'s `afterContent` in place. Only the first
   * recorded entry per path is mutated — second writes are no-ops on
   * the ledger so first-write-wins for `beforeContent` is preserved.
   */
  private readonly indexByPath = new Map<string, number>();
  private readonly installDir: string;
  private rolledBack = false;
  private preamble: PreambleSnapshot | null = null;

  /**
   * Optional logger. Defaults to no-op so unit tests don't need to mock
   * the real `logToFile` import. The agent-runner / agent-interface
   * wiring passes the canonical wizard logger.
   */
  private readonly log: (message: string, ...rest: unknown[]) => void;

  constructor(
    installDir: string,
    log?: (message: string, ...rest: unknown[]) => void,
  ) {
    this.installDir = resolve(installDir);
    this.log = log ?? (() => undefined);
  }

  /**
   * Capture the directory-level "what existed before the wizard ran"
   * snapshot. Call once at run start, before the agent has touched
   * anything. Idempotent — subsequent calls are no-ops, so a retry path
   * that re-invokes the wizard within the same process doesn't lose the
   * original snapshot.
   */
  capturePreamble(): void {
    if (this.preamble) return;
    const gitignorePath = resolve(this.installDir, '.gitignore');
    const amplitudeDir = resolve(this.installDir, '.amplitude');
    let originalGitignore: string | null = null;
    try {
      if (existsSync(gitignorePath)) {
        originalGitignore = readFileSync(gitignorePath, 'utf8');
      }
    } catch (err) {
      this.log(
        `[ledger] capturePreamble: failed to read .gitignore: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    let amplitudeDirExistedBefore: boolean;
    try {
      amplitudeDirExistedBefore =
        existsSync(amplitudeDir) && statSync(amplitudeDir).isDirectory();
    } catch {
      amplitudeDirExistedBefore = false;
    }
    this.preamble = { originalGitignore, amplitudeDirExistedBefore };
  }

  /**
   * Record the "before" half of a write. Called from PreToolUse, when
   * the agent has announced intent to write but hasn't done so yet.
   * Reads the current on-disk content (or notes its absence) so the
   * rollback path can restore it later.
   *
   * No-op if:
   *   - the path is outside the install directory
   *   - we've already recorded an entry for this path
   *
   * The latter preserves first-write-wins: a second write to the same
   * path leaves the original `beforeContent` intact, which is exactly
   * what the rollback needs to revert ALL the agent's edits to that
   * file.
   */
  recordPreWrite(rawPath: string): void {
    const abs = this.normalize(rawPath);
    if (!abs) return;
    if (this.indexByPath.has(abs)) return;
    let beforeContent: string | null = null;
    let kindHint: FileChangeKind = 'modify';
    try {
      if (existsSync(abs)) {
        beforeContent = readFileSync(abs, 'utf8');
      } else {
        kindHint = 'create';
      }
    } catch (err) {
      this.log(
        `[ledger] recordPreWrite: read failed for ${abs}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // Keep going with a null beforeContent — better to roll back
      // imperfectly than not at all.
    }
    const entry: FileChangeEntry = {
      path: abs,
      beforeContent,
      afterContent: null,
      kind: kindHint,
      ts: Date.now(),
    };
    this.entries.push(entry);
    this.indexByPath.set(abs, this.entries.length - 1);
  }

  /**
   * Record the "after" half of a write. Called from PostToolUse, once
   * the agent's tool has actually executed and the new content is on
   * disk. Updates the matching pre-entry in place; if no pre-entry
   * exists (e.g. the SDK fired PostToolUse without a corresponding
   * PreToolUse, which can happen for MultiEdit fan-out), records a
   * fresh entry with `beforeContent: null`.
   *
   * `afterContentHint` is the content the agent passed to the tool
   * (Write.content, Edit.new_string, etc.). When non-null we trust it;
   * when null we re-read from disk, which is the truth either way.
   */
  recordPostWrite(rawPath: string, afterContentHint?: string | null): void {
    const abs = this.normalize(rawPath);
    if (!abs) return;
    let afterContent: string | null = afterContentHint ?? null;
    if (afterContent === null) {
      try {
        if (existsSync(abs)) {
          afterContent = readFileSync(abs, 'utf8');
        }
      } catch (err) {
        this.log(
          `[ledger] recordPostWrite: read failed for ${abs}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    const idx = this.indexByPath.get(abs);
    if (idx !== undefined) {
      const entry = this.entries[idx];
      // Only update afterContent — don't overwrite first-write
      // beforeContent. The kind stays whatever PreWrite decided.
      entry.afterContent = afterContent;
      entry.ts = Date.now();
      return;
    }
    // No matching PreWrite — record a fresh entry. Pre-existence is
    // unknown at this point (e.g. a MultiEdit fan-out where we missed
    // the PreToolUse, or a tool that didn't fire PreToolUse at all).
    // Default to `kind: 'modify'` with `beforeContent: null`: the
    // rollback writer interprets that as "leave the file alone" rather
    // than "delete it." Data preservation beats aggressive cleanup —
    // if the file pre-existed the wizard, deleting it on rollback
    // would lose the user's prior content.
    const entry: FileChangeEntry = {
      path: abs,
      beforeContent: null,
      afterContent,
      kind: 'modify',
      ts: Date.now(),
    };
    this.entries.push(entry);
    this.indexByPath.set(abs, this.entries.length - 1);
  }

  /**
   * Number of distinct paths the ledger has tracked. Useful for tests
   * and the user-facing cancel message.
   */
  size(): number {
    return this.entries.length;
  }

  /** Read-only snapshot of recorded entries (test / diagnostic use). */
  getEntries(): readonly FileChangeEntry[] {
    return this.entries;
  }

  /**
   * Resolved install directory the ledger was constructed with. Exposed so
   * read-only consumers (e.g. {@link summarizeLedgerPath}) can normalize a
   * raw lookup path the same way `recordPreWrite` / `recordPostWrite` did
   * before storing the entry — otherwise a relative or `..`-bearing path
   * would silently miss the lookup.
   */
  getInstallDir(): string {
    return this.installDir;
  }

  /**
   * Reverse the ledger. Walks entries in last-in-first-out order so a
   * file written then edited is restored from its first-recorded
   * `beforeContent`.
   *
   * Idempotent: a second call is a no-op.
   *
   * Order:
   *   1. Per-entry rollback (reverse the agent's writes).
   *   2. Restore `.gitignore` to its pre-run content (or remove if
   *      it didn't exist).
   *   3. Remove `.amplitude/` if it didn't exist at run start.
   */
  rollback(): RollbackResult {
    const result: RollbackResult = {
      filesReverted: 0,
      filesRemoved: 0,
      failures: [],
    };
    if (this.rolledBack) return result;
    this.rolledBack = true;

    // 1. Per-entry rollback. Iterate in reverse so a (write, edit) pair
    //    is reverted in (edit-undo, write-undo) order — same shape git
    //    revert uses for stacked commits.
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      try {
        this.revertEntry(entry, result);
      } catch (err) {
        result.failures.push({
          path: entry.path,
          reason: err instanceof Error ? err.message : String(err),
        });
        this.log(
          `[ledger] rollback: revertEntry failed for ${entry.path}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // 2. Preamble: restore `.gitignore` to its captured content. The
    //    per-entry pass above already covers the case where the agent
    //    wrote `.gitignore` via Edit (first-write-wins gives us the
    //    original content there). This second restore is for cases
    //    where the gitignore mutation came from a path the ledger
    //    didn't intercept (e.g. a future helper that bypasses Write/
    //    Edit). It's idempotent with the per-entry pass — restoring
    //    the same content twice is a no-op.
    if (this.preamble) {
      const gitignorePath = resolve(this.installDir, '.gitignore');
      try {
        if (this.preamble.originalGitignore === null) {
          if (existsSync(gitignorePath)) {
            unlinkSync(gitignorePath);
            result.filesRemoved += 1;
          }
        } else {
          const current = existsSync(gitignorePath)
            ? readFileSync(gitignorePath, 'utf8')
            : null;
          if (current !== this.preamble.originalGitignore) {
            atomicWriteFile(gitignorePath, this.preamble.originalGitignore);
            // Don't double-count: if the per-entry pass already reverted
            // .gitignore, increment was already recorded. Only credit
            // the revert when the file was actually different.
            result.filesReverted += 1;
          }
        }
      } catch (err) {
        result.failures.push({
          path: gitignorePath,
          reason: err instanceof Error ? err.message : String(err),
        });
      }

      // 3. `.amplitude/` directory: blow it away if it didn't exist
      //    before the run. The per-entry pass deleted any individual
      //    files inside that the agent created, but the directory
      //    itself can stick around if we don't drop it explicitly —
      //    confusing for users who expect a clean revert.
      if (!this.preamble.amplitudeDirExistedBefore) {
        const amplitudeDir = resolve(this.installDir, '.amplitude');
        try {
          if (existsSync(amplitudeDir)) {
            rmSync(amplitudeDir, { recursive: true, force: true });
          }
        } catch (err) {
          result.failures.push({
            path: amplitudeDir,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return result;
  }

  /** Test-only helper. Clears the rolled-back flag so a suite can re-exercise. */
  _resetForTests(): void {
    this.rolledBack = false;
  }

  /**
   * Resolve / validate a path:
   *   - empty / relative-trickery paths return null (skip)
   *   - paths outside the install directory return null (skip)
   *   - paths inside the wizard's own cache root (~/.amplitude/wizard)
   *     return null even if installDir somehow contains it
   */
  private normalize(rawPath: string): string | null {
    if (!rawPath || typeof rawPath !== 'string') return null;
    const abs = isAbsolute(rawPath)
      ? resolve(rawPath)
      : resolve(this.installDir, rawPath);
    // Reject paths that escape the install directory. `relative()`
    // returning a path that starts with `..` means the target is
    // outside the install dir.
    const rel = relative(this.installDir, abs);
    if (rel.startsWith('..') || isAbsolute(rel)) return null;
    // Defensive: skip the wizard's own cache root if it ever ended up
    // under installDir (shouldn't happen, but handles edge cases like
    // a user pointing the wizard at their home directory).
    if (rel === '' || rel.split(sep).includes('.amplitude-wizard-cache')) {
      return null;
    }
    return abs;
  }

  /**
   * Reverse a single ledger entry. Mutates `result` with the count
   * deltas. Throws on filesystem errors so the caller's try/catch can
   * record them in `result.failures` keyed to the path.
   */
  private revertEntry(entry: FileChangeEntry, result: RollbackResult): void {
    switch (entry.kind) {
      case 'create': {
        // Agent created this file — delete it.
        if (existsSync(entry.path)) {
          unlinkSync(entry.path);
          result.filesRemoved += 1;
        }
        return;
      }
      case 'modify': {
        // Agent edited an existing file — restore the original.
        if (entry.beforeContent === null) {
          // We don't know the original content. Best we can do is leave
          // the file alone — deleting it would lose the user's prior
          // content. Log and move on.
          this.log(
            `[ledger] revertEntry: no beforeContent for modified ${entry.path}; leaving as-is`,
          );
          return;
        }
        // Skip the write if the file is already at the original content
        // (a no-op edit, or two-pass rollback). Keeps `filesReverted`
        // count honest.
        const current = existsSync(entry.path)
          ? readFileSync(entry.path, 'utf8')
          : null;
        if (current === entry.beforeContent) return;
        atomicWriteFile(entry.path, entry.beforeContent);
        result.filesReverted += 1;
        return;
      }
      case 'delete': {
        // Agent deleted this file — restore from beforeContent.
        if (entry.beforeContent === null) {
          this.log(
            `[ledger] revertEntry: no beforeContent for deleted ${entry.path}; cannot restore`,
          );
          return;
        }
        atomicWriteFile(entry.path, entry.beforeContent);
        result.filesReverted += 1;
        return;
      }
    }
  }
}

/**
 * Atomic-rename file write for arbitrary text content. Mirrors
 * `atomicWriteJSON` but skips the JSON.stringify step — rollback
 * content is opaque text we never want to reformat.
 *
 * Defined here rather than in `atomic-write.ts` so the rollback path
 * stays a single-file unit; we'd otherwise need to widen the public
 * surface of `atomic-write.ts` for one new caller. If a third caller
 * shows up, hoist this into the shared module.
 */
function atomicWriteFile(filePath: string, content: string): void {
  // Ensure parent directory exists — the rollback may need to recreate
  // a file whose parent dir was removed by an earlier ledger entry.
  try {
    mkdirSync(dirname(filePath), { recursive: true });
  } catch {
    // Best-effort; writeFileSync below will surface the real error
    // if the parent really can't be created.
  }
  const tmp = `${filePath}.${process.pid}.rollback.tmp`;
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, filePath);
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // Best-effort cleanup
    }
    throw err;
  }
}

// ── Module-level singleton ───────────────────────────────────────────
//
// The ledger is logically a per-run object, but the cancel path in
// `wizardAbort()` lives below `agent-runner` in the dependency graph
// and can't easily receive a ledger instance threaded through the
// session. A module-level singleton — same shape as the wizard-wide
// abort controller — gives every consumer a stable accessor.
//
// Lifetime: created lazily on first access. In production each
// `npx @amplitude/wizard` invocation is a fresh process so there's
// no per-run reset path; tests use `resetFileChangeLedger()`.

let _ledger: FileChangeLedger | null = null;

/**
 * Initialise (or reset) the wizard-wide ledger for the current run.
 * Call once near the top of the run with the resolved install dir.
 * Returns the new ledger so the caller can also keep a local handle.
 *
 * `log` is optional — when omitted, the ledger uses the canonical
 * wizard `logToFile` so capture/revert diagnostics land in the
 * per-project log file. Tests can pass a no-op or a spy.
 */
export function initFileChangeLedger(
  installDir: string,
  log?: (message: string, ...rest: unknown[]) => void,
): FileChangeLedger {
  _ledger = new FileChangeLedger(installDir, log ?? logToFile);
  _ledger.capturePreamble();
  return _ledger;
}

/**
 * Returns the current ledger, or `null` if none has been initialised.
 * Hooks call this from PreToolUse / PostToolUse without forcing a
 * dependency on the agent-runner — if we're running outside a normal
 * wizard session (e.g. a unit test of the inner agent), the ledger
 * is absent and capture is skipped.
 */
export function getFileChangeLedger(): FileChangeLedger | null {
  return _ledger;
}

/** Test-only: drop the singleton between test cases. */
export function resetFileChangeLedger(): void {
  _ledger = null;
}

/**
 * Outcome of {@link executeRollbackWithStatus}, useful for analytics /
 * tests. Mirrors the underlying {@link RollbackResult} but adds an
 * `executed` flag so callers can distinguish "no ledger present" or
 * "nothing to revert" from a real revert pass.
 */
export interface ExecuteRollbackOutcome {
  /** True when {@link FileChangeLedger.rollback} actually ran. */
  executed: boolean;
  /** Number of `modify` / `delete` entries reverted. `0` when not executed. */
  filesReverted: number;
  /** Number of `create` entries removed. `0` when not executed. */
  filesRemoved: number;
  /** User-facing summary message; `null` when there was nothing to surface. */
  message: string | null;
}

/**
 * Run the singleton ledger's rollback and surface the user-facing status
 * line through {@link onStatus}. Extracted from `agent-runner.ts` so the
 * OutroScreen's `[R] Revert changes` prompt (PR adding `preserveFiles`
 * to OutroData) can trigger the same revert path without duplicating
 * the formatting / logging plumbing.
 *
 *  - Returns `executed: false` when there is no ledger or nothing to
 *    revert; the call site can show a short "no changes to revert"
 *    confirmation instead of the standard message.
 *  - Honors the ledger's idempotency: a second call after rollback has
 *    already run is a no-op and returns `executed: false`.
 *  - Catches and logs filesystem errors so a partial revert never blocks
 *    the calling screen.
 */
export function executeRollbackWithStatus(
  onStatus: (message: string) => void,
  log: (message: string, ...rest: unknown[]) => void = logToFile,
): ExecuteRollbackOutcome {
  const ledger = getFileChangeLedger();
  if (!ledger) {
    return {
      executed: false,
      filesReverted: 0,
      filesRemoved: 0,
      message: null,
    };
  }
  try {
    const result = ledger.rollback();
    const reverted = result.filesReverted;
    const removed = result.filesRemoved;
    if (reverted === 0 && removed === 0) {
      log('[ledger] rollback: nothing to revert');
      return {
        executed: false,
        filesReverted: 0,
        filesRemoved: 0,
        message: null,
      };
    }
    const message = `Wizard cancelled. Your repo has been restored to its pre-wizard state. (${reverted} file${
      reverted === 1 ? '' : 's'
    } reverted, ${removed} file${removed === 1 ? '' : 's'} removed.)`;
    log(`[ledger] ${message}`);
    try {
      onStatus(message);
    } catch {
      /* surfaced to log already */
    }
    if (result.failures.length > 0) {
      log(
        `[ledger] rollback: ${result.failures.length} failure${
          result.failures.length === 1 ? '' : 's'
        }: ${result.failures.map((f) => `${f.path} (${f.reason})`).join(', ')}`,
      );
    }
    return {
      executed: true,
      filesReverted: reverted,
      filesRemoved: removed,
      message,
    };
  } catch (err) {
    log(
      `[ledger] rollback threw: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return {
      executed: false,
      filesReverted: 0,
      filesRemoved: 0,
      message: null,
    };
  }
}
