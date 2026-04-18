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
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAttemptId, getRunId } from './observability';
import { logToFile } from '../utils/debug';

/** Serialized shape written to disk on PreCompact. */
export interface SerializedAgentState {
  schema: 'amplitude-wizard-agent-state/1';
  runId: string;
  attemptId: string;
  timestamp: string;
  modifiedFiles: string[];
  lastStatus: { code: string; detail: string } | null;
  compactionCount: number;
}

export class AgentState {
  /** Files the agent has written or edited during this attempt. */
  private modifiedFiles = new Set<string>();
  private lastStatus: { code: string; detail: string } | null = null;
  private compactionCount = 0;

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
      schema: 'amplitude-wizard-agent-state/1',
      runId: getRunId(),
      attemptId: getAttemptId(),
      timestamp: new Date().toISOString(),
      modifiedFiles: [...this.modifiedFiles].sort(),
      lastStatus: this.lastStatus,
      compactionCount: this.compactionCount,
    };
  }

  /** Path where PreCompact persists the snapshot for the current attempt. */
  serializationPath(): string {
    return join(tmpdir(), `amplitude-wizard-state-${getAttemptId()}.json`);
  }

  /** Write the snapshot to disk. Non-throwing — failures are logged only. */
  persist(): string | null {
    const path = this.serializationPath();
    try {
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
}

/**
 * Read a previously-persisted snapshot. Returns null on any failure so the
 * caller can fall back to a cold start. Validates only the schema tag — full
 * field validation is left to the consumer for forward compatibility.
 */
export function loadSnapshot(path: string): SerializedAgentState | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<SerializedAgentState>;
    if (parsed.schema !== 'amplitude-wizard-agent-state/1') {
      logToFile(`loadSnapshot: schema mismatch — got ${String(parsed.schema)}`);
      return null;
    }
    return parsed as SerializedAgentState;
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
