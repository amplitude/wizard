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

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getRunId } from './observability';
import { logToFile } from '../utils/debug';

export interface SerializedAgentState {
  schemaVersion: 'amplitude-wizard-agent-state/1';
  runId: string | null;
  attemptId: string | null;
  modifiedFiles: string[];
  lastStatus: { code: string; detail: string } | null;
  compactionCount: number;
  persistedAt: number;
}

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
  persist(): void {
    const path = this.snapshotPath();
    try {
      writeFileSync(path, JSON.stringify(this.snapshot(), null, 2), {
        mode: 0o600,
      });
    } catch (err) {
      logToFile(`AgentState persist failed: ${String(err)}`);
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
