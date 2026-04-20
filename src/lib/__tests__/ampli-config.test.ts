import { describe, it, expect } from 'vitest';
import {
  parseAmpliConfig,
  isConfigured,
  isMinimallyConfigured,
  mergeAmpliConfig,
  hasMergeConflicts,
  type AmpliConfig,
} from '../ampli-config.js';

// ── parseAmpliConfig ──────────────────────────────────────────────────────────

describe('parseAmpliConfig', () => {
  it('parses a valid ampli.json', () => {
    const raw = JSON.stringify({
      OrgId: '36958',
      WorkspaceId: '0adfd673-c53b-462c-bf88-84c7605286a4',
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
    expect(isMinimallyConfigured({ OrgId: '123', WorkspaceId: 'xyz' })).toBe(
      false,
    );
  });

  it('returns false for empty config', () => {
    expect(isMinimallyConfigured({})).toBe(false);
  });
});

// ── isConfigured ─────────────────────────────────────────────────────────────

describe('isConfigured', () => {
  it('returns true when OrgId, WorkspaceId, and SourceId are all present', () => {
    const config: AmpliConfig = {
      OrgId: '36958',
      WorkspaceId: '0adfd673',
      SourceId: '478440ff',
    };
    expect(isConfigured(config)).toBe(true);
  });

  it('returns false when SourceId is missing', () => {
    expect(isConfigured({ OrgId: '1', WorkspaceId: '2' })).toBe(false);
  });

  it('returns false when WorkspaceId is missing', () => {
    expect(isConfigured({ OrgId: '1', SourceId: '3' })).toBe(false);
  });

  it('returns false when OrgId is missing', () => {
    expect(isConfigured({ WorkspaceId: '2', SourceId: '3' })).toBe(false);
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
      WorkspaceId: '2',
      Branch: 'main',
    };
    const result = mergeAmpliConfig(existing, {
      SourceId: 'new-source',
      Branch: 'develop',
    });
    expect(result).toEqual({
      OrgId: '1',
      WorkspaceId: '2',
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
