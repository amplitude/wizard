import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  parseAmpliConfig,
  isConfigured,
  isMinimallyConfigured,
  mergeAmpliConfig,
  hasMergeConflicts,
  readAmpliConfig,
  writeAmpliConfig,
  clearAuthFieldsInAmpliConfig,
  type AmpliConfig,
} from '../ampli-config.js';

// ── parseAmpliConfig ──────────────────────────────────────────────────────────

describe('parseAmpliConfig', () => {
  it('parses a valid ampli.json', () => {
    const raw = JSON.stringify({
      OrgId: '36958',
      ProjectId: '0adfd673-c53b-462c-bf88-84c7605286a4',
      SourceId: '478440ff-666e-4998-8278-84ff7488dfa1',
      Branch: 'main',
      Path: './src/ampli',
      Version: '158.0.0',
      Runtime: 'node.js:typescript-ampli',
    });

    const result = parseAmpliConfig(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.OrgId).toBe('36958');
    expect(result.config.ProjectId).toBe(
      '0adfd673-c53b-462c-bf88-84c7605286a4',
    );
    expect(result.config.SourceId).toBe('478440ff-666e-4998-8278-84ff7488dfa1');
    expect(result.config.Branch).toBe('main');
  });

  it('parses a minimal config (only SourceId)', () => {
    const raw = JSON.stringify({ SourceId: 'abc-123' });
    const result = parseAmpliConfig(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.SourceId).toBe('abc-123');
  });

  it('parses an empty object', () => {
    const result = parseAmpliConfig('{}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toEqual({});
  });

  it('returns invalid_json for malformed JSON', () => {
    const result = parseAmpliConfig('{ OrgId: not valid json }');
    expect(result).toEqual({ ok: false, error: 'invalid_json' });
  });

  it('returns invalid_json for a JSON array', () => {
    const result = parseAmpliConfig('["not", "an", "object"]');
    expect(result).toEqual({ ok: false, error: 'invalid_json' });
  });

  it('returns invalid_json for a JSON primitive', () => {
    const result = parseAmpliConfig('"just a string"');
    expect(result).toEqual({ ok: false, error: 'invalid_json' });
  });

  it('returns merge_conflicts when file has git conflict markers', () => {
    const conflicted = [
      '<<<<<<< HEAD',
      '{ "OrgId": "111" }',
      '=======',
      '{ "OrgId": "222" }',
      '>>>>>>> feature-branch',
    ].join('\n');

    const result = parseAmpliConfig(conflicted);
    expect(result).toEqual({ ok: false, error: 'merge_conflicts' });
  });

  // ── Legacy WorkspaceId → ProjectId migration ──
  it('migrates legacy WorkspaceId to ProjectId at parse time', () => {
    const raw = JSON.stringify({
      OrgId: '36958',
      WorkspaceId: 'legacy-ws-id',
      SourceId: 'src-1',
      Zone: 'us',
    });

    const result = parseAmpliConfig(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.ProjectId).toBe('legacy-ws-id');
    // WorkspaceId is stripped from the downstream shape
    expect(result.config.WorkspaceId).toBeUndefined();
    expect(result.config.OrgId).toBe('36958');
    expect(result.config.SourceId).toBe('src-1');
    expect(result.config.Zone).toBe('us');
  });

  it('prefers ProjectId when both WorkspaceId and ProjectId are present', () => {
    const raw = JSON.stringify({
      OrgId: '36958',
      WorkspaceId: 'legacy-id',
      ProjectId: 'new-id',
      SourceId: 'src-1',
    });

    const result = parseAmpliConfig(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.ProjectId).toBe('new-id');
    expect(result.config.WorkspaceId).toBeUndefined();
  });
});

// ── hasMergeConflicts ────────────────────────────────────────────────────────

describe('hasMergeConflicts', () => {
  it('returns true when all three markers are present', () => {
    const text = '<<<<<<< HEAD\nfoo\n=======\nbar\n>>>>>>> other';
    expect(hasMergeConflicts(text)).toBe(true);
  });

  it('returns false when no markers are present', () => {
    expect(hasMergeConflicts('{ "OrgId": "123" }')).toBe(false);
  });

  it('returns false when only some markers are present', () => {
    expect(hasMergeConflicts('<<<<<<< HEAD\nfoo')).toBe(false);
  });
});

// ── isMinimallyConfigured ────────────────────────────────────────────────────

describe('isMinimallyConfigured', () => {
  it('returns true when SourceId is present', () => {
    expect(isMinimallyConfigured({ SourceId: 'abc' })).toBe(true);
  });

  it('returns false when SourceId is absent', () => {
    expect(isMinimallyConfigured({ OrgId: '123', ProjectId: 'xyz' })).toBe(
      false,
    );
  });

  it('returns false for empty config', () => {
    expect(isMinimallyConfigured({})).toBe(false);
  });
});

// ── isConfigured ─────────────────────────────────────────────────────────────

describe('isConfigured', () => {
  it('returns true when OrgId, ProjectId, and SourceId are all present', () => {
    const config: AmpliConfig = {
      OrgId: '36958',
      ProjectId: '0adfd673',
      SourceId: '478440ff',
    };
    expect(isConfigured(config)).toBe(true);
  });

  it('returns false when SourceId is missing', () => {
    expect(isConfigured({ OrgId: '1', ProjectId: '2' })).toBe(false);
  });

  it('returns false when ProjectId is missing', () => {
    expect(isConfigured({ OrgId: '1', SourceId: '3' })).toBe(false);
  });

  it('returns false when OrgId is missing', () => {
    expect(isConfigured({ ProjectId: '2', SourceId: '3' })).toBe(false);
  });

  it('returns false when only the legacy WorkspaceId is set (not ProjectId)', () => {
    // The downstream view never sees WorkspaceId — parse normalizes it to
    // ProjectId. If something bypasses the parser and constructs a config
    // manually with only WorkspaceId, that should count as not configured.
    expect(isConfigured({ OrgId: '1', WorkspaceId: '2', SourceId: '3' })).toBe(
      false,
    );
  });

  it('returns false for empty config', () => {
    expect(isConfigured({})).toBe(false);
  });
});

// ── mergeAmpliConfig ─────────────────────────────────────────────────────────

describe('mergeAmpliConfig', () => {
  it('merges updates into an existing config', () => {
    const existing: AmpliConfig = {
      OrgId: '1',
      ProjectId: '2',
      Branch: 'main',
    };
    const result = mergeAmpliConfig(existing, {
      SourceId: 'new-source',
      Branch: 'develop',
    });
    expect(result).toEqual({
      OrgId: '1',
      ProjectId: '2',
      Branch: 'develop',
      SourceId: 'new-source',
    });
  });

  it('does not mutate the original config', () => {
    const existing: AmpliConfig = { OrgId: '1' };
    mergeAmpliConfig(existing, { OrgId: '2' });
    expect(existing.OrgId).toBe('1');
  });

  it('ignores undefined values in updates', () => {
    const existing: AmpliConfig = { OrgId: '1', Branch: 'main' };
    const result = mergeAmpliConfig(existing, {
      OrgId: undefined,
      Branch: 'develop',
    });
    expect(result.OrgId).toBe('1');
    expect(result.Branch).toBe('develop');
  });

  it('handles merging into an empty config', () => {
    const result = mergeAmpliConfig({}, { OrgId: '99', SourceId: 'abc' });
    expect(result).toEqual({ OrgId: '99', SourceId: 'abc' });
  });

  it('handles updates that are all undefined (no-op)', () => {
    const existing: AmpliConfig = { OrgId: '1' };
    const result = mergeAmpliConfig(existing, { SourceId: undefined });
    expect(result).toEqual({ OrgId: '1' });
  });
});

// ── Read / write round-trip (I/O) ─────────────────────────────────────────────

describe('readAmpliConfig + writeAmpliConfig round-trip', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ampli-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('auto-migrates a legacy WorkspaceId file to ProjectId on next save', () => {
    // Simulate a legacy ampli.json that was written before the rename.
    const legacyPath = path.join(tmpDir, 'ampli.json');
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({
        OrgId: '36958',
        WorkspaceId: 'legacy-ws-id',
        SourceId: 'src-1',
        Zone: 'us',
      }),
      'utf-8',
    );

    // Read: legacy field migrates to ProjectId at the parse boundary.
    const parsed = readAmpliConfig(tmpDir);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.config.ProjectId).toBe('legacy-ws-id');
    expect(parsed.config.WorkspaceId).toBeUndefined();

    // Write back: the file is now in the new format, no WorkspaceId.
    writeAmpliConfig(tmpDir, parsed.config);
    const rawOnDisk = fs.readFileSync(legacyPath, 'utf-8');
    const json = JSON.parse(rawOnDisk) as Record<string, unknown>;
    expect(json.ProjectId).toBe('legacy-ws-id');
    expect(json.WorkspaceId).toBeUndefined();
    expect(json.OrgId).toBe('36958');
    expect(json.SourceId).toBe('src-1');
    expect(json.Zone).toBe('us');
  });
});

// ── clearAuthFieldsInAmpliConfig ──────────────────────────────────────────────

describe('clearAuthFieldsInAmpliConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ampli-config-clear-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes both WorkspaceId and ProjectId (belt-and-suspenders)', () => {
    // File has BOTH keys somehow (e.g. hand-edited, or a malformed migration).
    fs.writeFileSync(
      path.join(tmpDir, 'ampli.json'),
      JSON.stringify({
        OrgId: 'org-1',
        ProjectId: 'new-proj',
        WorkspaceId: 'old-ws',
        SourceId: 'src-1',
        Branch: 'main',
        Zone: 'us',
      }),
      'utf-8',
    );

    clearAuthFieldsInAmpliConfig(tmpDir);

    const rawOnDisk = fs.readFileSync(path.join(tmpDir, 'ampli.json'), 'utf-8');
    const json = JSON.parse(rawOnDisk) as Record<string, unknown>;
    expect(json.OrgId).toBeUndefined();
    expect(json.ProjectId).toBeUndefined();
    expect(json.WorkspaceId).toBeUndefined();
    expect(json.Zone).toBeUndefined();
    // Tracking-plan fields are preserved.
    expect(json.SourceId).toBe('src-1');
    expect(json.Branch).toBe('main');
  });

  it('is a no-op when ampli.json is missing', () => {
    expect(() => clearAuthFieldsInAmpliConfig(tmpDir)).not.toThrow();
    expect(fs.existsSync(path.join(tmpDir, 'ampli.json'))).toBe(false);
  });
});
