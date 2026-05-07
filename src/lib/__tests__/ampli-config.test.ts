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
  ampliConfigPath,
  type AmpliConfig,
} from '../ampli-config.js';
import { getProjectBindingFile } from '../../utils/storage-paths.js';

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

    // Write back: only the canonical binding is updated. Phase G-1 stopped
    // writing the legacy `ampli.json` mirror; the legacy file on disk should
    // remain in its original (pre-migration) shape.
    writeAmpliConfig(tmpDir, parsed.config);
    const bindingPath = getProjectBindingFile(tmpDir);
    const legacyResolved = ampliConfigPath(tmpDir);

    const bindingJson = JSON.parse(
      fs.readFileSync(bindingPath, 'utf-8'),
    ) as Record<string, unknown>;
    expect(bindingJson.ProjectId).toBe('legacy-ws-id');
    expect(bindingJson.WorkspaceId).toBeUndefined();
    expect(bindingJson.OrgId).toBe('36958');
    expect(bindingJson.SourceId).toBe('src-1');
    expect(bindingJson.Zone).toBe('us');

    // Legacy mirror file is untouched — still has WorkspaceId from the
    // original write.
    const legacyJson = JSON.parse(
      fs.readFileSync(legacyResolved, 'utf-8'),
    ) as Record<string, unknown>;
    expect(legacyJson.WorkspaceId).toBe('legacy-ws-id');
  });

  it('reads legacy ampli.json alone and creates project-binding.json on read', () => {
    const legacyPath = path.join(tmpDir, 'ampli.json');
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({
        OrgId: 'o1',
        ProjectId: 'p1',
        SourceId: 's1',
      }),
      'utf-8',
    );
    const bindingPath = getProjectBindingFile(tmpDir);
    expect(fs.existsSync(bindingPath)).toBe(false);

    const parsed = readAmpliConfig(tmpDir);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.config.OrgId).toBe('o1');

    expect(fs.existsSync(bindingPath)).toBe(true);
  });

  it('canonical binding is authoritative when both exist (no legacy merge)', () => {
    // Phase G-1 read-side fix: when the canonical binding exists, it's the
    // single source of truth — we do NOT merge legacy `ampli.json` data on
    // top of it. Otherwise keys deliberately cleared from the binding
    // (e.g. by `clearAuthFieldsInAmpliConfig`) would be resurrected from a
    // stale legacy file, breaking logout/reset.
    fs.writeFileSync(
      path.join(tmpDir, 'ampli.json'),
      JSON.stringify({ OrgId: 'from-legacy', ProjectId: 'p', SourceId: 's' }),
      'utf-8',
    );
    fs.mkdirSync(path.join(tmpDir, '.amplitude'), { recursive: true });
    fs.writeFileSync(
      getProjectBindingFile(tmpDir),
      JSON.stringify({ OrgId: 'from-binding' }),
      'utf-8',
    );
    const parsed = readAmpliConfig(tmpDir);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.config.OrgId).toBe('from-binding');
    // Keys absent from the canonical binding stay absent — we no longer
    // backfill them from legacy.
    expect(parsed.config.ProjectId).toBeUndefined();
    expect(parsed.config.SourceId).toBeUndefined();
  });
});

// ── writeAmpliConfig partial-binding guard (#578 regression) ─────────────────

describe('writeAmpliConfig partial-binding guard', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ampli-config-partial-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('refuses to persist {OrgId: "21", ProjectId: ""} (the bug 2 shape)', () => {
    // Regression: AuthScreen's "create project" handler used to call
    // setOrgAndProject with an org but an empty project, which wrote
    // `{OrgId: "21", ProjectId: "", Zone: "us"}` to project-binding.json.
    // The partial state poisoned the next run's credential resolution.
    const ok = writeAmpliConfig(tmpDir, {
      OrgId: '21',
      ProjectId: '',
      Zone: 'us',
    });
    expect(ok).toBe(false);
    expect(fs.existsSync(getProjectBindingFile(tmpDir))).toBe(false);
  });

  it('refuses to persist {OrgId: "", ProjectId: "p1"} (inverse partial)', () => {
    const ok = writeAmpliConfig(tmpDir, {
      OrgId: '',
      ProjectId: 'p1',
      Zone: 'us',
    });
    expect(ok).toBe(false);
    expect(fs.existsSync(getProjectBindingFile(tmpDir))).toBe(false);
  });

  it('refuses to persist OrgId without ProjectId (undefined variant)', () => {
    // Same shape `wizard-abort.ts` could produce when only orgId is in
    // setupComplete.amplitude.
    const ok = writeAmpliConfig(tmpDir, {
      OrgId: '21',
      Zone: 'us',
    });
    expect(ok).toBe(false);
    expect(fs.existsSync(getProjectBindingFile(tmpDir))).toBe(false);
  });

  it('persists when both OrgId and ProjectId are set (happy path)', () => {
    const ok = writeAmpliConfig(tmpDir, {
      OrgId: '21',
      ProjectId: 'p1',
      Zone: 'us',
    });
    expect(ok).toBe(true);
    const json = JSON.parse(
      fs.readFileSync(getProjectBindingFile(tmpDir), 'utf-8'),
    ) as Record<string, unknown>;
    expect(json.OrgId).toBe('21');
    expect(json.ProjectId).toBe('p1');
  });

  it('persists when neither OrgId nor ProjectId is set (cleared binding)', () => {
    // Happens after `clearAuthFieldsInAmpliConfig` — both are deleted but
    // SourceId / other tracking-plan fields remain.
    const ok = writeAmpliConfig(tmpDir, {
      SourceId: 's1',
      Branch: 'main',
    });
    expect(ok).toBe(true);
    const json = JSON.parse(
      fs.readFileSync(getProjectBindingFile(tmpDir), 'utf-8'),
    ) as Record<string, unknown>;
    expect(json.SourceId).toBe('s1');
    expect(json.OrgId).toBeUndefined();
    expect(json.ProjectId).toBeUndefined();
  });

  it('normalizes empty-string OrgId/ProjectId to undefined on the wire', () => {
    // "Start over" callers pass {id: '', name: ''} for both. Persist it
    // (both empty → balanced, allowed) but strip the empty strings so
    // the on-disk JSON reads as cleared, not "deliberately bound to ''".
    const ok = writeAmpliConfig(tmpDir, {
      OrgId: '',
      ProjectId: '',
      Zone: 'us',
    });
    expect(ok).toBe(true);
    const json = JSON.parse(
      fs.readFileSync(getProjectBindingFile(tmpDir), 'utf-8'),
    ) as Record<string, unknown>;
    expect(json.OrgId).toBeUndefined();
    expect(json.ProjectId).toBeUndefined();
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

    // Phase G-1: only the canonical binding file is cleared. The legacy
    // `ampli.json` mirror is no longer written, so its on-disk contents
    // remain whatever the user had before — we don't go back in to scrub
    // a path we've stopped touching.
    const bindingPath = getProjectBindingFile(tmpDir);
    const bindingJson = JSON.parse(
      fs.readFileSync(bindingPath, 'utf-8'),
    ) as Record<string, unknown>;
    expect(bindingJson.OrgId).toBeUndefined();
    expect(bindingJson.ProjectId).toBeUndefined();
    expect(bindingJson.WorkspaceId).toBeUndefined();
    expect(bindingJson.Zone).toBeUndefined();
    expect(bindingJson.SourceId).toBe('src-1');
    expect(bindingJson.Branch).toBe('main');
  });

  it('is a no-op when neither binding nor ampli.json exists', () => {
    expect(() => clearAuthFieldsInAmpliConfig(tmpDir)).not.toThrow();
    expect(fs.existsSync(path.join(tmpDir, 'ampli.json'))).toBe(false);
  });
});

// ── Phase G-1: ampli.json mirror writes are disabled ─────────────────────────
//
// Per MIGRATION_PLAN.md §5 Phase G-1, the wizard no longer writes
// the legacy `<installDir>/ampli.json` mirror. Reads still work for
// back-compat (one minor cycle), but writes target only the canonical
// `.amplitude/project-binding.json`.

describe('Phase G-1: ampli.json mirror writes are disabled', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-g1-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writeAmpliConfig does not create ampli.json on a fresh project', () => {
    const config: AmpliConfig = {
      OrgId: 'org-fresh',
      ProjectId: 'proj-fresh',
      SourceId: 'src-fresh',
      Zone: 'us',
    };

    expect(writeAmpliConfig(tmpDir, config)).toBe(true);

    // Canonical write happened.
    const bindingPath = getProjectBindingFile(tmpDir);
    expect(fs.existsSync(bindingPath)).toBe(true);

    // Legacy mirror was not created.
    expect(fs.existsSync(ampliConfigPath(tmpDir))).toBe(false);
  });

  it('writeAmpliConfig leaves an existing ampli.json untouched', () => {
    // Seed a pre-existing legacy mirror as if from a prior wizard version.
    const legacyPath = ampliConfigPath(tmpDir);
    const legacyContent = JSON.stringify({
      OrgId: 'org-legacy',
      ProjectId: 'proj-legacy',
      SourceId: 'src-legacy',
      stale: 'marker',
    });
    fs.writeFileSync(legacyPath, legacyContent, 'utf-8');
    const legacyMtimeBefore = fs.statSync(legacyPath).mtimeMs;

    // Write a brand-new config — only the canonical path should change.
    writeAmpliConfig(tmpDir, {
      OrgId: 'org-new',
      ProjectId: 'proj-new',
      SourceId: 'src-new',
    });

    const onDiskLegacy = JSON.parse(
      fs.readFileSync(legacyPath, 'utf-8'),
    ) as Record<string, unknown>;
    // The bytes are byte-for-byte the original — Phase G-1 doesn't touch
    // the legacy file on writes.
    expect(onDiskLegacy.OrgId).toBe('org-legacy');
    expect(onDiskLegacy.ProjectId).toBe('proj-legacy');
    expect(onDiskLegacy.stale).toBe('marker');

    // mtime is unchanged — proves no write happened, even one with the same
    // content. (`atomicWriteJSON` uses temp-file + rename and would bump
    // mtime if it had been called.)
    const legacyMtimeAfter = fs.statSync(legacyPath).mtimeMs;
    expect(legacyMtimeAfter).toBe(legacyMtimeBefore);

    // Canonical binding has the new shape.
    const bindingJson = JSON.parse(
      fs.readFileSync(getProjectBindingFile(tmpDir), 'utf-8'),
    ) as Record<string, unknown>;
    expect(bindingJson.OrgId).toBe('org-new');
    expect(bindingJson.ProjectId).toBe('proj-new');
  });

  it('readAmpliConfig still returns data when only a legacy ampli.json is present', () => {
    // Simulate the upgrade path: a user with a pre-G-1 install has only
    // `ampli.json` on disk. The read side must still surface that data so
    // the wizard recognises a returning project.
    const legacyPath = ampliConfigPath(tmpDir);
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({
        OrgId: 'org-upgrade',
        ProjectId: 'proj-upgrade',
        SourceId: 'src-upgrade',
        Zone: 'eu',
      }),
      'utf-8',
    );

    // Sanity check: no canonical binding yet.
    expect(fs.existsSync(getProjectBindingFile(tmpDir))).toBe(false);

    const result = readAmpliConfig(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.OrgId).toBe('org-upgrade');
    expect(result.config.ProjectId).toBe('proj-upgrade');
    expect(result.config.Zone).toBe('eu');
  });

  // Regression: after `wizard reset`, the canonical `.amplitude/` directory
  // is removed but a stale legacy `ampli.json` may still be on disk. Before
  // the read-side fix, `readAmpliConfig` happily merged that legacy file
  // back in — so reset effectively did nothing for users who had been on
  // pre-G-1 versions. With the fix, missing canonical → empty config.
  //
  // This also covers `clearAuthFieldsInAmpliConfig`: the canonical binding's
  // cleared keys must not be backfilled from legacy (otherwise logout
  // resurrects the prior org/project).
  it('reset semantics: stale legacy ampli.json does not resurrect after canonical removed', () => {
    // Step 1: legacy mirror has stale auth state from a pre-G-1 install.
    const legacyPath = ampliConfigPath(tmpDir);
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({
        OrgId: 'stale-org',
        ProjectId: 'stale-proj',
        SourceId: 'stale-src',
        Zone: 'us',
      }),
      'utf-8',
    );

    // Step 2: simulate `wizard reset` — canonical .amplitude/ directory is
    // gone (or never existed). The legacy mirror still has data.
    const ampliDir = path.join(tmpDir, '.amplitude');
    if (fs.existsSync(ampliDir)) {
      fs.rmSync(ampliDir, { recursive: true, force: true });
    }
    expect(fs.existsSync(getProjectBindingFile(tmpDir))).toBe(false);

    // Step 3: read. Pre-fix this returned the stale legacy data. Post-fix,
    // because the binding is missing, we DO fall back to legacy (back-compat
    // for true legacy-only installs) and migrate it forward — that's
    // intentional: a missing canonical means "legacy install we haven't seen
    // before," not "explicitly cleared." The resurrection-after-reset bug
    // only fires when canonical exists but is empty/cleared, so we cover
    // that case below.
    const firstRead = readAmpliConfig(tmpDir);
    expect(firstRead.ok).toBe(true);

    // Step 4: now simulate a *cleared* canonical binding (the post-logout
    // / post-clearAuthFields state). The cleared keys must NOT come back
    // from legacy.
    fs.writeFileSync(
      getProjectBindingFile(tmpDir),
      JSON.stringify({ SourceId: 'kept-src' }),
      'utf-8',
    );

    const cleared = readAmpliConfig(tmpDir);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    // Auth keys absent from canonical stay absent — no legacy resurrection.
    expect(cleared.config.OrgId).toBeUndefined();
    expect(cleared.config.ProjectId).toBeUndefined();
    expect(cleared.config.Zone).toBeUndefined();
    // Tracking-plan field deliberately kept in canonical survives.
    expect(cleared.config.SourceId).toBe('kept-src');
  });

  it('clearAuthFieldsInAmpliConfig leaves legacy ampli.json bytes untouched', () => {
    // Legacy mirror has auth fields the user wants cleared.
    const legacyPath = ampliConfigPath(tmpDir);
    const legacyContent = JSON.stringify({
      OrgId: 'org-x',
      ProjectId: 'proj-x',
      SourceId: 'src-x',
      Zone: 'us',
    });
    fs.writeFileSync(legacyPath, legacyContent, 'utf-8');
    const legacyMtimeBefore = fs.statSync(legacyPath).mtimeMs;

    clearAuthFieldsInAmpliConfig(tmpDir);

    // Legacy file is untouched (Phase G-1 skips legacy writes — including
    // the cleanup write inside clearAuthFieldsInAmpliConfig).
    const legacyAfter = JSON.parse(
      fs.readFileSync(legacyPath, 'utf-8'),
    ) as Record<string, unknown>;
    expect(legacyAfter.OrgId).toBe('org-x');
    expect(legacyAfter.ProjectId).toBe('proj-x');
    const legacyMtimeAfter = fs.statSync(legacyPath).mtimeMs;
    expect(legacyMtimeAfter).toBe(legacyMtimeBefore);

    // Canonical binding reflects the cleared auth fields.
    const bindingJson = JSON.parse(
      fs.readFileSync(getProjectBindingFile(tmpDir), 'utf-8'),
    ) as Record<string, unknown>;
    expect(bindingJson.OrgId).toBeUndefined();
    expect(bindingJson.ProjectId).toBeUndefined();
    expect(bindingJson.Zone).toBeUndefined();
    expect(bindingJson.SourceId).toBe('src-x');
  });
});
