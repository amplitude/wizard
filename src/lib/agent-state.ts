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

  /** Reset all mutable state for a fresh retry attempt. */
  reset(): void {
    this.modifiedFiles.clear();
    this.lastStatus = null;
    this.compactionCount = 0;
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
