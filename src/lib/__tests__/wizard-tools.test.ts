import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  resolveEnvPath,
  ensureGitignoreCoverage,
  parseEnvKeys,
  mergeEnvValues,
  persistEventPlan,
  cleanupIntegrationSkills,
  cleanupAmplitudeEventsFile,
  cleanupWizardArtifacts,
  ensureWizardArtifactsIgnored,
  WIZARD_GITIGNORE_PATTERNS,
} from '../wizard-tools';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-tools-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// resolveEnvPath
// ---------------------------------------------------------------------------

describe('resolveEnvPath', () => {
  it('resolves a relative path within the working directory', () => {
    const result = resolveEnvPath('/project', '.env.local');
    expect(result).toBe(path.resolve('/project', '.env.local'));
  });

  it('resolves nested paths', () => {
    const result = resolveEnvPath('/project', 'config/.env');
    expect(result).toBe(path.resolve('/project', 'config/.env'));
  });

  it('rejects path traversal with ../', () => {
    expect(() => resolveEnvPath('/project', '../etc/passwd')).toThrow(
      'Path traversal rejected',
    );
  });

  it('rejects absolute paths outside working directory', () => {
    expect(() => resolveEnvPath('/project', '/etc/passwd')).toThrow(
      'Path traversal rejected',
    );
  });

  it('allows the working directory itself', () => {
    // edge case: filePath resolves to exactly workingDirectory
    expect(() => resolveEnvPath('/project', '.')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// parseEnvKeys
// ---------------------------------------------------------------------------

describe('parseEnvKeys', () => {
  it('parses simple KEY=value lines', () => {
    const keys = parseEnvKeys('FOO=bar\nBAZ=qux\n');
    expect(keys).toEqual(new Set(['FOO', 'BAZ']));
  });

  it('ignores comments', () => {
    const keys = parseEnvKeys('# COMMENT=ignored\nFOO=bar\n');
    expect(keys).toEqual(new Set(['FOO']));
  });

  it('ignores blank lines', () => {
    const keys = parseEnvKeys('\n\nFOO=bar\n\n');
    expect(keys).toEqual(new Set(['FOO']));
  });

  it('handles keys with leading whitespace', () => {
    const keys = parseEnvKeys('  FOO=bar\n');
    expect(keys).toEqual(new Set(['FOO']));
  });

  it('handles keys with spaces around =', () => {
    const keys = parseEnvKeys('FOO =bar\n');
    expect(keys).toEqual(new Set(['FOO']));
  });

  it('handles keys with underscores and numbers', () => {
    const keys = parseEnvKeys('MY_KEY_2=value\n');
    expect(keys).toEqual(new Set(['MY_KEY_2']));
  });

  it('returns empty set for empty content', () => {
    const keys = parseEnvKeys('');
    expect(keys).toEqual(new Set());
  });

  it('ignores lines without = sign', () => {
    const keys = parseEnvKeys('not a key value pair\nFOO=bar\n');
    expect(keys).toEqual(new Set(['FOO']));
  });

  it('parses keys with quoted values', () => {
    const keys = parseEnvKeys('FOO="bar baz"\nBAR=\'single\'\n');
    expect(keys).toEqual(new Set(['FOO', 'BAR']));
  });
});

// ---------------------------------------------------------------------------
// mergeEnvValues
// ---------------------------------------------------------------------------

describe('mergeEnvValues', () => {
  it('appends new keys to empty content', () => {
    const result = mergeEnvValues('', { FOO: 'bar' });
    expect(result).toBe('FOO=bar\n');
  });

  it('appends new keys to existing content', () => {
    const result = mergeEnvValues('EXISTING=val\n', { NEW: 'added' });
    expect(result).toBe('EXISTING=val\nNEW=added\n');
  });

  it('updates existing keys in-place', () => {
    const result = mergeEnvValues('FOO=old\nBAR=keep\n', { FOO: 'new' });
    expect(result).toBe('FOO=new\nBAR=keep\n');
  });

  it('handles mixed update and append', () => {
    const result = mergeEnvValues('FOO=old\n', {
      FOO: 'updated',
      BAR: 'new',
    });
    expect(result).toBe('FOO=updated\nBAR=new\n');
  });

  it('adds newline before appending if content lacks trailing newline', () => {
    const result = mergeEnvValues('FOO=bar', { BAZ: 'qux' });
    expect(result).toBe('FOO=bar\nBAZ=qux\n');
  });

  it('handles multiple new keys', () => {
    const result = mergeEnvValues('', { A: '1', B: '2', C: '3' });
    expect(result).toContain('A=1\n');
    expect(result).toContain('B=2\n');
    expect(result).toContain('C=3\n');
  });

  it('handles values containing = signs', () => {
    const result = mergeEnvValues('', {
      DB_URL: 'postgres://host:5432/db?opt=1',
    });
    expect(result).toBe('DB_URL=postgres://host:5432/db?opt=1\n');
  });

  it('updates a value containing = signs', () => {
    const result = mergeEnvValues('DB_URL=old://host\n', {
      DB_URL: 'postgres://new:5432/db?opt=1',
    });
    expect(result).toBe('DB_URL=postgres://new:5432/db?opt=1\n');
  });

  it('updates a key whose old value contains the key name', () => {
    const result = mergeEnvValues('FOO=FOO_old_value\n', { FOO: 'new' });
    expect(result).toBe('FOO=new\n');
  });
});

// ---------------------------------------------------------------------------
// ensureGitignoreCoverage
// ---------------------------------------------------------------------------

describe('ensureGitignoreCoverage', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  it('creates .gitignore if it does not exist', () => {
    ensureGitignoreCoverage(tmpDir, '.env.local');
    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(content).toBe('.env.local\n');
  });

  it('appends entry to existing .gitignore', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules\n');
    ensureGitignoreCoverage(tmpDir, '.env.local');
    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(content).toBe('node_modules\n.env.local\n');
  });

  it('appends with newline if .gitignore lacks trailing newline', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules');
    ensureGitignoreCoverage(tmpDir, '.env');
    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(content).toBe('node_modules\n.env\n');
  });

  it('does not duplicate an existing entry', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.env.local\n');
    ensureGitignoreCoverage(tmpDir, '.env.local');
    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(content).toBe('.env.local\n');
  });

  it('handles entry with surrounding whitespace in .gitignore', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '  .env.local  \n');
    ensureGitignoreCoverage(tmpDir, '.env.local');
    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    // Should not duplicate — the trim check should match
    expect(content).toBe('  .env.local  \n');
  });
});

// ---------------------------------------------------------------------------
// cleanupIntegrationSkills
// ---------------------------------------------------------------------------

describe('cleanupIntegrationSkills', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  function makeSkill(name: string): void {
    const dir = path.join(tmpDir, '.claude', 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '# test skill\n');
  }

  function skillExists(name: string): boolean {
    return fs.existsSync(path.join(tmpDir, '.claude', 'skills', name));
  }

  it('removes integration- directories and keeps others', () => {
    makeSkill('integration-nextjs-app-router');
    makeSkill('integration-django');
    makeSkill('instrumentation-events');
    makeSkill('taxonomy-quickstart');
    makeSkill('user-custom-skill');

    cleanupIntegrationSkills(tmpDir);

    expect(skillExists('integration-nextjs-app-router')).toBe(false);
    expect(skillExists('integration-django')).toBe(false);
    expect(skillExists('instrumentation-events')).toBe(true);
    expect(skillExists('taxonomy-quickstart')).toBe(true);
    expect(skillExists('user-custom-skill')).toBe(true);
  });

  it('is a no-op when .claude/skills/ does not exist', () => {
    expect(() => cleanupIntegrationSkills(tmpDir)).not.toThrow();
  });

  it('is a no-op when skills directory is empty', () => {
    fs.mkdirSync(path.join(tmpDir, '.claude', 'skills'), { recursive: true });
    expect(() => cleanupIntegrationSkills(tmpDir)).not.toThrow();
  });

  it('leaves taxonomy and instrumentation dirs untouched when no integrations present', () => {
    makeSkill('instrumentation-events');
    makeSkill('taxonomy-quickstart');

    cleanupIntegrationSkills(tmpDir);

    expect(skillExists('instrumentation-events')).toBe(true);
    expect(skillExists('taxonomy-quickstart')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// persistEventPlan
// ---------------------------------------------------------------------------

describe('persistEventPlan', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  it('writes the canonical {name, description} shape to .amplitude-events.json', () => {
    const events = [
      { name: 'user signed up', description: 'Fires when signup completes' },
      { name: 'product viewed', description: 'Fires on PDP mount' },
    ];
    expect(persistEventPlan(tmpDir, events)).toBe(true);

    const raw = fs.readFileSync(
      path.join(tmpDir, '.amplitude-events.json'),
      'utf8',
    );
    expect(JSON.parse(raw)).toEqual(events);
  });

  it('overwrites a pre-existing non-canonical file (e.g. snake_case event_name)', () => {
    const planPath = path.join(tmpDir, '.amplitude-events.json');
    // Simulate what the agent wrote directly, in the wrong shape.
    fs.writeFileSync(
      planPath,
      JSON.stringify([
        {
          event_name: 'External Resource Opened',
          description: 'Non-canonical',
          file_path: 'src/app/page.tsx',
        },
      ]),
    );

    persistEventPlan(tmpDir, [{ name: 'canonical', description: 'fixed' }]);

    const parsed = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    expect(parsed).toEqual([{ name: 'canonical', description: 'fixed' }]);
    // Structural check: canonical shape only, no legacy fields.
    expect(parsed[0].event_name).toBeUndefined();
    expect(parsed[0].file_path).toBeUndefined();
  });

  it('returns false when the working directory does not exist', () => {
    const nonexistent = path.join(tmpDir, 'does', 'not', 'exist');
    expect(
      persistEventPlan(nonexistent, [{ name: 'x', description: 'y' }]),
    ).toBe(false);
  });

  it('writes an empty array when given no events (idempotent clear)', () => {
    expect(persistEventPlan(tmpDir, [])).toBe(true);
    const raw = fs.readFileSync(
      path.join(tmpDir, '.amplitude-events.json'),
      'utf8',
    );
    expect(JSON.parse(raw)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ensureWizardArtifactsIgnored
// ---------------------------------------------------------------------------

describe('ensureWizardArtifactsIgnored', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  function readGitignore(): string {
    return fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
  }

  it('creates .gitignore with the wizard block when none exists', () => {
    ensureWizardArtifactsIgnored(tmpDir);
    const content = readGitignore();
    expect(content).toContain('# Amplitude wizard');
    for (const pattern of WIZARD_GITIGNORE_PATTERNS) {
      expect(content).toContain(pattern);
    }
  });

  it('appends the wizard block to an existing .gitignore', () => {
    const existing = 'node_modules\n.env.local\n';
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), existing, 'utf8');
    ensureWizardArtifactsIgnored(tmpDir);
    const content = readGitignore();
    // Preserves the original entries
    expect(content).toContain('node_modules');
    expect(content).toContain('.env.local');
    // And the wizard block was appended
    expect(content).toContain('# Amplitude wizard');
    expect(content).toContain('.amplitude-events.json');
  });

  it('is idempotent — running twice does not duplicate entries', () => {
    ensureWizardArtifactsIgnored(tmpDir);
    const after1 = readGitignore();
    ensureWizardArtifactsIgnored(tmpDir);
    const after2 = readGitignore();
    expect(after1).toBe(after2);
    // Marker should appear exactly once
    const occurrences = (after2.match(/# Amplitude wizard/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('updates an existing wizard block when patterns change', () => {
    // Simulate an older wizard version having written a smaller block
    fs.writeFileSync(
      path.join(tmpDir, '.gitignore'),
      'node_modules\n# Amplitude wizard\n.amplitude-events.json\n',
      'utf8',
    );
    ensureWizardArtifactsIgnored(tmpDir);
    const content = readGitignore();
    // Now contains all current patterns
    for (const pattern of WIZARD_GITIGNORE_PATTERNS) {
      expect(content).toContain(pattern);
    }
    // User content above the block is preserved
    expect(content).toContain('node_modules');
    // Marker still appears exactly once (in-place replacement)
    const occurrences = (content.match(/# Amplitude wizard/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('preserves user content below the wizard block when replacing it', () => {
    // Regression: a previous version's regex `# Amplitude wizard(?:\n[^\n]*)*`
    // was greedy and matched empty lines, so it consumed everything from the
    // marker to EOF — silently deleting user gitignore entries below the
    // wizard block when the block was replaced (e.g. on a wizard upgrade
    // that adds a new pattern). This test pins the fix.
    fs.writeFileSync(
      path.join(tmpDir, '.gitignore'),
      [
        'node_modules',
        '# Amplitude wizard',
        '.amplitude-events.json',
        '',
        '# user blocks below — must survive',
        'dist/',
        '.env.production',
      ].join('\n') + '\n',
      'utf8',
    );
    ensureWizardArtifactsIgnored(tmpDir);
    const content = readGitignore();
    expect(content).toContain('node_modules');
    // User content below the wizard block must be preserved
    expect(content).toContain('# user blocks below — must survive');
    expect(content).toContain('dist/');
    expect(content).toContain('.env.production');
    // And the wizard block was still updated with all current patterns
    for (const pattern of WIZARD_GITIGNORE_PATTERNS) {
      expect(content).toContain(pattern);
    }
    // Marker still appears exactly once
    const occurrences = (content.match(/# Amplitude wizard/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('survives an unwritable .gitignore without throwing', () => {
    // Simulate a failure by passing a path under a non-existent dir
    const bogus = path.join(tmpDir, 'does-not-exist', 'nested');
    expect(() => ensureWizardArtifactsIgnored(bogus)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// cleanupAmplitudeEventsFile
// ---------------------------------------------------------------------------

describe('cleanupAmplitudeEventsFile', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  it('removes .amplitude-events.json when present', () => {
    const target = path.join(tmpDir, '.amplitude-events.json');
    fs.writeFileSync(target, '[]', 'utf8');
    cleanupAmplitudeEventsFile(tmpDir);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('is a no-op when the file does not exist', () => {
    expect(() => cleanupAmplitudeEventsFile(tmpDir)).not.toThrow();
  });

  it('does not touch other files in the install dir', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, '.amplitude-events.json'), '[]');
    cleanupAmplitudeEventsFile(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.amplitude-events.json'))).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// cleanupWizardArtifacts (composition)
// ---------------------------------------------------------------------------

describe('cleanupWizardArtifacts', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  it('on success: removes integration skills, preserves the events file', () => {
    // Regression: previously deleted .amplitude-events.json on every exit,
    // breaking resumability. Now ALL exit paths preserve the file (it's
    // gitignored so it can't pollute commits regardless), and only the
    // success path deletes the single-use integration skill.
    const skillDir = path.join(
      tmpDir,
      '.claude',
      'skills',
      'integration-nextjs',
    );
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# nextjs');
    fs.writeFileSync(path.join(tmpDir, '.amplitude-events.json'), '[]');

    cleanupWizardArtifacts(tmpDir, { onSuccess: true });

    expect(fs.existsSync(skillDir)).toBe(false);
    // .amplitude-events.json is now PRESERVED on success — it's the
    // canonical record of the user's confirmed event plan.
    expect(fs.existsSync(path.join(tmpDir, '.amplitude-events.json'))).toBe(
      true,
    );
  });

  it('on cancel/error (no onSuccess): preserves integration skills AND events file', () => {
    // Regression for: a Ctrl+C / wizardAbort / transient error used to
    // wipe .amplitude-events.json AND .claude/skills/integration-*,
    // forcing a fresh re-confirm of the entire event plan and re-download
    // of the SDK-setup skill. Now everything stays on disk so re-run
    // resumes seamlessly.
    const skillDir = path.join(
      tmpDir,
      '.claude',
      'skills',
      'integration-nextjs',
    );
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# nextjs');
    fs.writeFileSync(path.join(tmpDir, '.amplitude-events.json'), '[]');

    cleanupWizardArtifacts(tmpDir);

    expect(fs.existsSync(skillDir)).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.amplitude-events.json'))).toBe(
      true,
    );
  });

  it('still leaves instrumentation and taxonomy skills on disk', () => {
    const keep = [
      'add-analytics-instrumentation',
      'amplitude-chart-dashboard-plan',
      'amplitude-quickstart-taxonomy-agent',
    ];
    for (const name of keep) {
      const dir = path.join(tmpDir, '.claude', 'skills', name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), '# kept');
    }

    cleanupWizardArtifacts(tmpDir, { onSuccess: true });

    for (const name of keep) {
      expect(fs.existsSync(path.join(tmpDir, '.claude', 'skills', name))).toBe(
        true,
      );
    }
  });

  it('is a no-op on a clean install dir (no throw)', () => {
    expect(() => cleanupWizardArtifacts(tmpDir)).not.toThrow();
    expect(() =>
      cleanupWizardArtifacts(tmpDir, { onSuccess: true }),
    ).not.toThrow();
  });
});
