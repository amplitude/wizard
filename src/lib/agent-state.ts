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

import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';
import { getRunId } from './observability';
import { logToFile } from '../utils/debug';
import { atomicWriteJSON } from '../utils/atomic-write';

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

  /** Persist the current state to the tmpdir path for this attempt. */
  persist(): string | null {
    const path = this.snapshotPath();
    try {
      atomicWriteJSON(path, this.snapshot(), 0o600);
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
    return join(tmpdir(), `amplitude-wizard-state-${id}.json`);
  }

  reset(): void {
    this.modifiedFiles.clear();
    this.lastStatus = null;
    this.compactionCount = 0;
  }
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
