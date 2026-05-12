/**
 * Unit tests for L1-idempotent-rerun.
 *
 * The scorer reads the second run's `file_change_applied` events off
 * `Artifact.secondRunLog`. Tests cover:
 *   - skip-pass when secondRunLog is absent (no signal, weight 0)
 *   - clean re-run with same files modified — passes
 *   - clean re-run with strict subset — passes
 *   - second run creates a NEW file the first didn't touch — fails
 *   - second run deletes a file the first created — fails
 *   - second run modifies a file the first never touched — fails
 */

import { describe, expect, it } from 'vitest';

import type {
  AgentEventEnvelope,
  FileChangeAppliedData,
} from '../../../src/lib/agent-events.js';
import { scorer } from '../layer1-structural/idempotent-rerun.js';
import type { Artifact, Scenario } from '../../runner/types.js';

function fileEvent(
  path: string,
  operation: FileChangeAppliedData['operation'],
): AgentEventEnvelope {
  return {
    v: 1,
    '@timestamp': '2026-05-08T10:00:00.000Z',
    type: 'lifecycle',
    message: `file_change_applied: ${path}`,
    data: { event: 'file_change_applied', path, operation },
    data_version: 1,
  } as AgentEventEnvelope;
}

function makeArtifact(
  runLog: AgentEventEnvelope[],
  secondRunLog?: AgentEventEnvelope[],
): Artifact {
  return {
    runId: 'r-test',
    scenario: 'test',
    ring: 1,
    startedAt: '2026-05-08T10:00:00.000Z',
    finishedAt: '2026-05-08T10:00:01.000Z',
    exitCode: 0,
    runLog,
    fsSnapshot: { files: {}, diff: { added: [], modified: [], deleted: [] } },
    stderr: '',
    source: 'golden',
    secondRunLog,
  };
}

const FAKE_SCENARIO = {} as Scenario;

describe('L1-idempotent-rerun', () => {
  it('skip-passes with weight 0 when secondRunLog is absent', () => {
    const artifact = makeArtifact([fileEvent('a.ts', 'create')]);
    const result = scorer.evaluate(artifact, FAKE_SCENARIO);
    expect(result.pass).toBe(true);
    expect(result.weight).toBe(0);
    expect(result.detail).toContain('skipped');
  });

  it('passes when the second run touches the same files (modify-only)', () => {
    const first = [
      fileEvent('package.json', 'modify'),
      fileEvent('app/_layout.tsx', 'modify'),
    ];
    const second = [
      fileEvent('package.json', 'modify'),
      fileEvent('app/_layout.tsx', 'modify'),
    ];
    const result = scorer.evaluate(makeArtifact(first, second), FAKE_SCENARIO);
    expect(result.pass).toBe(true);
    expect(result.weight).toBe(5);
  });

  it('passes when the second run is a strict subset of the first', () => {
    const first = [
      fileEvent('package.json', 'modify'),
      fileEvent('app/_layout.tsx', 'modify'),
      fileEvent('app/index.tsx', 'modify'),
    ];
    const second = [fileEvent('app/_layout.tsx', 'modify')];
    const result = scorer.evaluate(makeArtifact(first, second), FAKE_SCENARIO);
    expect(result.pass).toBe(true);
    expect(result.weight).toBe(5);
  });

  it('fails when the second run creates a NEW file the first did not touch', () => {
    const first = [fileEvent('package.json', 'modify')];
    const second = [
      fileEvent('package.json', 'modify'),
      fileEvent('src/surprise.ts', 'create'),
    ];
    const result = scorer.evaluate(makeArtifact(first, second), FAKE_SCENARIO);
    expect(result.pass).toBe(false);
    expect(result.weight).toBe(5);
    expect(result.detail).toContain('created src/surprise.ts');
  });

  it('fails when the second run deletes a file the first created', () => {
    const first = [fileEvent('app/AmplitudeProvider.tsx', 'create')];
    const second = [fileEvent('app/AmplitudeProvider.tsx', 'delete')];
    const result = scorer.evaluate(makeArtifact(first, second), FAKE_SCENARIO);
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('deleted app/AmplitudeProvider.tsx');
  });

  it('fails when the second run modifies a file the first never touched', () => {
    const first = [fileEvent('package.json', 'modify')];
    const second = [
      fileEvent('package.json', 'modify'),
      fileEvent('app/forgotten.tsx', 'modify'),
    ];
    const result = scorer.evaluate(makeArtifact(first, second), FAKE_SCENARIO);
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('modified app/forgotten.tsx');
  });
});
