/**
 * Per-attempt mutable state bag for the agent run.
 *
 * PostToolUse on Write/Edit records modified files.
 * StatusReporter.onStatus records the last status message.
 * PreCompact serializes this bag to disk so a post-compaction UserPromptSubmit
 * hook can hydrate the agent with the context that compaction just dropped.
 *
 * Kept in its own module so hooks, wizard-tools, and tests can all touch it
 * without a cyclic import through agent-interface.
 */

import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

import { z } from 'zod';
import { getRunId } from './observability';
import { logToFile } from '../utils/debug';
import { ensureDir, getStateFile } from '../utils/storage-paths';

const SerializedAgentStateSchema = z.object({
  schemaVersion: z.literal('amplitude-wizard-agent-state/1'),
  runId: z.string().nullable(),
  attemptId: z.string().nullable(),
  modifiedFiles: z.array(z.string()),
  lastStatus: z.object({ code: z.string(), detail: z.string() }).nullable(),
  compactionCount: z.number(),
  persistedAt: z.number(),
});

/** Serialized shape written to disk on PreCompact. */
export type SerializedAgentState = z.infer<typeof SerializedAgentStateSchema>;

/**
 * Per-attempt agent recovery bag. Tracks which files the agent has written,
 * the last structured status it reported, and how many compactions have
 * happened this attempt. Serializes to a deterministic tmpdir path so a
 * post-compaction hook can read the snapshot back.
 */
export class AgentState {
  private readonly modifiedFiles = new Set<string>();
  private lastStatus: { code: string; detail: string } | null = null;
  private compactionCount = 0;
  private attemptId: string | null = null;
  /**
   * Discovery facts captured from prior in-attempt tool calls so a retry
   * doesn't redo the same exploration. Keyed by short stable names. Values
   * are short human-readable summaries already trimmed for prompt context.
   * Populated incrementally as tool results stream in (see
   * `recordToolResultDiscovery` below); read on retry to build the
   * `<retry-recovery>` hint prepended to the next attempt's user prompt.
   *
   * Bounded to a few entries — these are only the pre-discovery tools that
   * dominate the cold-start tail (package-manager / env-key probes / which
   * skill was loaded). Don't dump full Read/Glob outputs here; the hint
   * is meant to skip a tool call, not replay an entire conversation.
   */
  private readonly discoveries = new Map<string, string>();
  /**
   * Tool calls observed in the current attempt — small bounded counter
   * keyed by tool name. Used to surface "you already tried X N times" in
   * the retry hint so the model doesn't loop on a tool that's failing.
   */
  private readonly toolUseCounts = new Map<string, number>();

  setAttemptId(attemptId: string): void {
    this.attemptId = attemptId;
  }

  recordModifiedFile(filePath: string): void {
    if (filePath) this.modifiedFiles.add(filePath);
  }

  recordStatus(code: string, detail: string): void {
    this.lastStatus = { code, detail };
  }

  recordCompaction(): void {
    this.compactionCount += 1;
  }

  recordToolUse(toolName: string): void {
    if (!toolName) return;
    this.toolUseCounts.set(
      toolName,
      (this.toolUseCounts.get(toolName) ?? 0) + 1,
    );
  }

  /**
   * Stash a one-line summary of a discovery-shaped tool result so the next
   * attempt (after a transient retry) can skip the corresponding probe.
   *
   * Caller is responsible for trimming the summary — anything longer than
   * ~200 chars gets dropped to keep the retry-hint block small. Empty /
   * unknown summaries are a no-op (better to omit a fact than ship a
   * misleading one to the next attempt).
   */
  recordDiscovery(key: string, summary: string): void {
    if (!key) return;
    const trimmed = summary?.trim();
    if (!trimmed) return;
    if (trimmed.length > 200) return;
    this.discoveries.set(key, trimmed);
  }

  getDiscoveries(): ReadonlyMap<string, string> {
    return this.discoveries;
  }

  getToolUseCounts(): ReadonlyMap<string, number> {
    return this.toolUseCounts;
  }

  snapshot(): SerializedAgentState {
    return {
      schemaVersion: 'amplitude-wizard-agent-state/1',
      runId: getRunId() ?? null,
      attemptId: this.attemptId,
      modifiedFiles: [...this.modifiedFiles].sort(),
      lastStatus: this.lastStatus,
      compactionCount: this.compactionCount,
      persistedAt: Date.now(),
    };
  }

  /** Persist the current state to the cache-root path for this attempt. */
  persist(): string | null {
    const path = this.snapshotPath();
    try {
      // Make sure `<cacheRoot>/state/` exists; the cache root may not have
      // been created yet on a cold run.
      ensureDir(dirname(path));
      writeFileSync(path, JSON.stringify(this.snapshot(), null, 2), {
        mode: 0o600,
      });
      logToFile(`PreCompact: persisted agent state → ${path}`);
      return path;
    } catch (err) {
      logToFile(
        `PreCompact: failed to persist agent state: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  snapshotPath(): string {
    const id = this.attemptId ?? 'unknown';
    return getStateFile(id);
  }

  reset(): void {
    this.modifiedFiles.clear();
    this.lastStatus = null;
    this.compactionCount = 0;
    this.toolUseCounts.clear();
    // NOTE: `discoveries` is intentionally NOT cleared here. The retry path
    // calls reset() between attempts but wants the prior attempt's
    // discoveries (package manager, env keys, etc.) to carry forward into
    // the next attempt's prompt. Use `clearDiscoveries()` for a hard reset
    // (e.g. between unrelated wizard runs).
  }

  clearDiscoveries(): void {
    this.discoveries.clear();
  }
}

/**
 * Render a compact retry-recovery note to prepend to the next attempt's
 * user prompt. Mirrors `buildRecoveryNote` (post-compaction) but is keyed
 * to wizard-level retries triggered by transient gateway errors. The
 * agent restarts with a fresh conversation; without this hint, it redoes
 * detect_package_manager / check_env_keys / Skill loads and burns 10–20s
 * on probes that already succeeded.
 *
 * Returns an empty string when there are no preserved discoveries — the
 * caller can unconditionally concatenate.
 */
export function buildRetryHint(state: AgentState): string {
  const discoveries = state.getDiscoveries();
  const toolUseCounts = state.getToolUseCounts();
  if (discoveries.size === 0 && toolUseCounts.size === 0) return '';
  const lines: string[] = [
    '<retry-recovery>',
    'A prior attempt was interrupted by a transient upstream error and the wizard is retrying. The discoveries below were verified by tool calls in the prior attempt — trust them and SKIP the corresponding tool calls so this attempt can pick up from where the prior one left off:',
    '',
  ];
  for (const [key, summary] of discoveries) {
    lines.push(`- ${key}: ${summary}`);
  }
  const repeated = [...toolUseCounts.entries()].filter(([, n]) => n > 1);
  if (repeated.length > 0) {
    lines.push('', 'Tool call counts from the prior attempt:');
    for (const [tool, count] of repeated) {
      lines.push(`- ${tool}: called ${count} times`);
    }
  }
  lines.push('</retry-recovery>', '');
  return lines.join('\n');
}

/**
 * Read a previously-persisted snapshot. Returns null on any failure so the
 * caller can fall back to a cold start. Uses zod validation to ensure all
 * required fields are present and correctly typed.
 */
export function loadSnapshot(path: string): SerializedAgentState | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf8');
    const result = SerializedAgentStateSchema.safeParse(JSON.parse(raw));
    if (!result.success) {
      logToFile(`loadSnapshot: validation failed — ${result.error.message}`);
      return null;
    }
    return result.data;
  } catch (err) {
    logToFile(
      `loadSnapshot: read/parse failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

/**
 * Load + delete a snapshot in one step so restoration fires only once per
 * compaction cycle. Non-throwing.
 */
export function consumeSnapshot(path: string): SerializedAgentState | null {
  const snap = loadSnapshot(path);
  if (!snap) return null;
  try {
    unlinkSync(path);
  } catch {
    // Best-effort cleanup; a leftover file won't cause incorrect behavior
    // because the next compaction will overwrite it.
  }
  return snap;
}

/**
 * Render a compact recovery note to prepend to a user prompt after
 * compaction. Keeps the block short so it doesn't eat context budget —
 * only the signals an LLM actually needs to re-orient.
 */
export function buildRecoveryNote(snap: SerializedAgentState): string {
  const lines: string[] = [
    '<post-compaction-recovery>',
    `You are resuming a wizard run after a context compaction. The ${snap.compactionCount}x compaction summary may have dropped detail from earlier turns. Treat the list below as authoritative; do not re-edit files already modified unless the skill workflow requires it.`,
  ];
  if (snap.modifiedFiles.length > 0) {
    lines.push('', 'Files you have already modified in this run:');
    for (const file of snap.modifiedFiles) lines.push(`  - ${file}`);
  } else {
    lines.push('', 'No files have been modified yet in this run.');
  }
  if (snap.lastStatus) {
    lines.push(
      '',
      `Last reported status: [${snap.lastStatus.code}] ${snap.lastStatus.detail}`,
    );
  }
  lines.push('</post-compaction-recovery>', '');
  return lines.join('\n');
}
