/**
 * Unit tests for the orchestrator-context loader.
 *
 * Covers the four error envelopes (`not_found`, `not_a_file`,
 * `too_large`, `read_failed`, `empty`), the happy path including
 * UTF-8 BOM stripping and trim semantics, and the
 * `resolveOrchestratorContextPath` precedence (flag > env var).
 *
 * Goal: lock the file's contract before the inner-agent system-prompt
 * builder starts depending on its return shape — the loader is the
 * trust boundary for arbitrary text the orchestrator wants pinned to
 * every Claude turn.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  MAX_ORCHESTRATOR_CONTEXT_BYTES,
  loadOrchestratorContext,
  resolveOrchestratorContextPath,
} from '../orchestrator-context';

describe('resolveOrchestratorContextPath', () => {
  it('returns the flag value when provided', () => {
    expect(
      resolveOrchestratorContextPath('./my-context.md', {
        AMPLITUDE_WIZARD_CONTEXT: '/etc/other.md',
      }),
    ).toBe('./my-context.md');
  });

  it('falls back to the env var when no flag is provided', () => {
    expect(
      resolveOrchestratorContextPath(undefined, {
        AMPLITUDE_WIZARD_CONTEXT: '/etc/other.md',
      }),
    ).toBe('/etc/other.md');
  });

  it('treats whitespace-only flag values as absent (env still wins)', () => {
    expect(
      resolveOrchestratorContextPath('   ', {
        AMPLITUDE_WIZARD_CONTEXT: '/from/env.md',
      }),
    ).toBe('/from/env.md');
  });

  it('returns null when neither source is set', () => {
    expect(resolveOrchestratorContextPath(undefined, {})).toBeNull();
  });

  it('trims whitespace around env-var values', () => {
    expect(
      resolveOrchestratorContextPath(undefined, {
        AMPLITUDE_WIZARD_CONTEXT: '  /padded.md  ',
      }),
    ).toBe('/padded.md');
  });
});

describe('loadOrchestratorContext', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-ctx-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads a normal markdown file and returns trimmed content', () => {
    const target = path.join(tmpDir, 'context.md');
    fs.writeFileSync(target, '\n  use snake_case for events  \n\n');
    const result = loadOrchestratorContext(target, tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toBe('use snake_case for events');
    expect(result.sourcePath).toBe(target);
    expect(result.bytes).toBe(
      Buffer.byteLength('use snake_case for events', 'utf8'),
    );
  });

  it('strips a leading UTF-8 BOM (editors silently insert one)', () => {
    const target = path.join(tmpDir, 'bom.md');
    // 0xEF 0xBB 0xBF = UTF-8 BOM; ensure it is stripped before the trim.
    fs.writeFileSync(target, Buffer.from([0xef, 0xbb, 0xbf]));
    fs.appendFileSync(target, 'team conventions');
    const result = loadOrchestratorContext(target, tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.charCodeAt(0)).not.toBe(0xfeff);
    expect(result.content).toBe('team conventions');
  });

  it('resolves relative paths against the supplied cwd', () => {
    fs.writeFileSync(path.join(tmpDir, 'rel.md'), 'relative-resolved');
    const result = loadOrchestratorContext('rel.md', tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourcePath).toBe(path.join(tmpDir, 'rel.md'));
  });

  it('rejects a missing path with not_found', () => {
    const result = loadOrchestratorContext(
      path.join(tmpDir, 'does-not-exist.md'),
      tmpDir,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_found');
    expect(result.message).toMatch(/Could not stat/);
  });

  it('rejects a directory path with not_a_file', () => {
    const dir = path.join(tmpDir, 'sub');
    fs.mkdirSync(dir);
    const result = loadOrchestratorContext(dir, tmpDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_a_file');
  });

  it('rejects an empty file with empty', () => {
    const target = path.join(tmpDir, 'blank.md');
    fs.writeFileSync(target, '   \n\t\n');
    const result = loadOrchestratorContext(target, tmpDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('empty');
  });

  it('rejects an oversized file with too_large', () => {
    const target = path.join(tmpDir, 'huge.md');
    fs.writeFileSync(target, 'A'.repeat(MAX_ORCHESTRATOR_CONTEXT_BYTES + 1));
    const result = loadOrchestratorContext(target, tmpDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('too_large');
    expect(result.message).toMatch(/exceeds/);
  });

  it('accepts a file exactly at the cap', () => {
    const target = path.join(tmpDir, 'cap.md');
    fs.writeFileSync(target, 'B'.repeat(MAX_ORCHESTRATOR_CONTEXT_BYTES));
    const result = loadOrchestratorContext(target, tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes).toBe(MAX_ORCHESTRATOR_CONTEXT_BYTES);
  });
});
