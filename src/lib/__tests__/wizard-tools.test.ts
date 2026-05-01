import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  resolveEnvPath,
  ensureGitignoreCoverage,
  shouldSkipAutoGitignoreForEnvBasename,
  parseEnvKeys,
  mergeEnvValues,
  persistEventPlan,
  persistDashboard,
  cleanupIntegrationSkills,
  cleanupWizardArtifacts,
  ensureWizardArtifactsIgnored,
  buildFallbackReport,
  writeFallbackReportIfMissing,
  archiveSetupReportFile,
  restoreSetupReportIfMissing,
  normalizeEventName,
  PREVIOUS_SETUP_REPORT_FILENAME,
  WIZARD_GITIGNORE_PATTERNS,
  WIZARD_TOOL_NAMES,
  WIZARD_TOOLS_SERVER_NAME,
} from '../wizard-tools';
import { toWizardDashboardOpenUrl } from '../../utils/dashboard-open-url';

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
    ensureGitignoreCoverage(tmpDir, '.env.secrets');
    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(content).toBe('node_modules\n.env.secrets\n');
  });

  it('does not modify .gitignore for shared committed env template basenames', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules\n');
    ensureGitignoreCoverage(tmpDir, '.env.development');
    ensureGitignoreCoverage(tmpDir, '.env.production');
    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(content).toBe('node_modules\n');
  });

  it('does not create .gitignore when only skipped basenames would be covered', () => {
    ensureGitignoreCoverage(tmpDir, '.env');
    expect(fs.existsSync(path.join(tmpDir, '.gitignore'))).toBe(false);
  });

  it('shouldSkipAutoGitignoreForEnvBasename matches shared template set', () => {
    expect(shouldSkipAutoGitignoreForEnvBasename('.env.development')).toBe(
      true,
    );
    expect(shouldSkipAutoGitignoreForEnvBasename('.env.local')).toBe(false);
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
// normalizeEventName
// ---------------------------------------------------------------------------
//
// Soft format gate for `confirm_event_plan`. Pre-PR, the system prompt
// said "Title Case" but the tool's input schema description said
// "lowercase" — agents emitted both. The normalizer guarantees the
// persisted event plan and the user-facing prompt both match the
// canonical Title Case shape regardless of which guidance the model
// followed.

describe('normalizeEventName', () => {
  it('leaves correctly-shaped Title Case names unchanged', () => {
    expect(normalizeEventName('User Signed Up')).toBe('User Signed Up');
    expect(normalizeEventName('Product Added To Cart')).toBe(
      'Product Added To Cart',
    );
  });

  it('converts snake_case to Title Case', () => {
    expect(normalizeEventName('user_signed_up')).toBe('User Signed Up');
    expect(normalizeEventName('product_added_to_cart')).toBe(
      'Product Added To Cart',
    );
  });

  it('converts kebab-case to Title Case', () => {
    expect(normalizeEventName('checkout-started')).toBe('Checkout Started');
  });

  it('converts camelCase / PascalCase to Title Case', () => {
    expect(normalizeEventName('userSignedUp')).toBe('User Signed Up');
    expect(normalizeEventName('SearchPerformed')).toBe('Search Performed');
  });

  it('converts all-lowercase with spaces to Title Case', () => {
    expect(normalizeEventName('user signed up')).toBe('User Signed Up');
  });

  it('preserves short ALL-CAPS acronyms', () => {
    expect(normalizeEventName('api request sent')).toBe('Api Request Sent');
    expect(normalizeEventName('API Request Sent')).toBe('API Request Sent');
    expect(normalizeEventName('SDK Initialized')).toBe('SDK Initialized');
  });

  it('truncates names over 50 chars with an ellipsis', () => {
    const long = 'A'.repeat(60);
    const out = normalizeEventName(long);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith('…')).toBe(true);
  });

  it('returns the input unchanged when empty after trim', () => {
    expect(normalizeEventName('   ')).toBe('');
  });

  it('collapses multiple separators', () => {
    expect(normalizeEventName('user__signed___up')).toBe('User Signed Up');
    expect(normalizeEventName('user.signed.up')).toBe('User Signed Up');
  });
});

// ---------------------------------------------------------------------------
// persistEventPlan
// ---------------------------------------------------------------------------

describe('persistEventPlan', () => {
  let tmpDir: string;
  const canonical = (dir: string) =>
    path.join(dir, '.amplitude', 'events.json');
  const legacy = (dir: string) => path.join(dir, '.amplitude-events.json');

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  it('writes the canonical {name, description} shape to .amplitude/events.json', () => {
    const events = [
      { name: 'user signed up', description: 'Fires when signup completes' },
      { name: 'product viewed', description: 'Fires on PDP mount' },
    ];
    expect(persistEventPlan(tmpDir, events)).toBe(true);

    const raw = fs.readFileSync(canonical(tmpDir), 'utf8');
    expect(JSON.parse(raw)).toEqual(events);
  });

  it('also mirrors to the legacy .amplitude-events.json for skill backwards compat', () => {
    const events = [{ name: 'x', description: 'y' }];
    persistEventPlan(tmpDir, events);
    const raw = fs.readFileSync(legacy(tmpDir), 'utf8');
    expect(JSON.parse(raw)).toEqual(events);
  });

  it('overwrites a pre-existing non-canonical file (e.g. snake_case event_name)', () => {
    // Simulate what the agent wrote directly, in the wrong shape.
    fs.writeFileSync(
      legacy(tmpDir),
      JSON.stringify([
        {
          event_name: 'External Resource Opened',
          description: 'Non-canonical',
          file_path: 'src/app/page.tsx',
        },
      ]),
    );

    persistEventPlan(tmpDir, [{ name: 'canonical', description: 'fixed' }]);

    const parsedCanonical = JSON.parse(
      fs.readFileSync(canonical(tmpDir), 'utf8'),
    );
    const parsedLegacy = JSON.parse(fs.readFileSync(legacy(tmpDir), 'utf8'));
    expect(parsedCanonical).toEqual([
      { name: 'canonical', description: 'fixed' },
    ]);
    expect(parsedLegacy).toEqual([{ name: 'canonical', description: 'fixed' }]);
    // Structural check: canonical shape only, no legacy fields.
    expect(parsedLegacy[0].event_name).toBeUndefined();
    expect(parsedLegacy[0].file_path).toBeUndefined();
  });

  it('returns false when the working directory does not exist', () => {
    const nonexistent = path.join(tmpDir, 'does', 'not', 'exist');
    expect(
      persistEventPlan(nonexistent, [{ name: 'x', description: 'y' }]),
    ).toBe(false);
  });

  it('writes an empty array when given no events (idempotent clear)', () => {
    expect(persistEventPlan(tmpDir, [])).toBe(true);
    expect(JSON.parse(fs.readFileSync(canonical(tmpDir), 'utf8'))).toEqual([]);
    expect(JSON.parse(fs.readFileSync(legacy(tmpDir), 'utf8'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// persistDashboard — backs the `record_dashboard` MCP tool
// ---------------------------------------------------------------------------

describe('persistDashboard', () => {
  let tmpDir: string;
  const canonical = (dir: string) =>
    path.join(dir, '.amplitude', 'dashboard.json');

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  it('writes the canonical .amplitude/dashboard.json with the given payload', () => {
    const payload = {
      dashboardUrl: 'https://app.amplitude.com/123/dashboard/abc',
      dashboardId: 'abc',
      charts: [
        { id: 'c1', title: 'Onboarding Funnel', type: 'funnel' },
        { id: 'c2', title: 'Daily Actives', type: 'line' },
      ],
    };
    expect(persistDashboard(tmpDir, payload)).toBe(true);

    const raw = fs.readFileSync(canonical(tmpDir), 'utf8');
    expect(JSON.parse(raw)).toEqual(payload);
  });

  it('creates the .amplitude/ directory if it does not exist', () => {
    // Pre-condition: .amplitude/ does NOT exist on a fresh project.
    expect(fs.existsSync(path.join(tmpDir, '.amplitude'))).toBe(false);
    persistDashboard(tmpDir, { dashboardUrl: 'https://x' });
    expect(fs.existsSync(canonical(tmpDir))).toBe(true);
  });

  it('returns false when the working directory does not exist', () => {
    const nonexistent = path.join(tmpDir, 'does', 'not', 'exist');
    expect(persistDashboard(nonexistent, { dashboardUrl: 'https://x' })).toBe(
      false,
    );
  });

  it('overwrites a pre-existing dashboard file (idempotent re-record)', () => {
    persistDashboard(tmpDir, { dashboardUrl: 'https://old' });
    persistDashboard(tmpDir, { dashboardUrl: 'https://new', dashboardId: 'n' });
    const parsed = JSON.parse(fs.readFileSync(canonical(tmpDir), 'utf8'));
    expect(parsed).toEqual({ dashboardUrl: 'https://new', dashboardId: 'n' });
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
    // Canonical `.amplitude/` covers events.json + dashboard.json.
    expect(content).toContain('.amplitude/');
    // Legacy mirrors must also be ignored: bundled context-hub skills
    // still write `.amplitude-events.json` and `.amplitude-dashboard.json`
    // during runs, and a `git add .` mid-run would otherwise stage them.
    expect(content).toContain('.amplitude-events.json');
    expect(content).toContain('.amplitude-dashboard.json');
    // PR 316 design: the CURRENT user-facing setup report
    // (`amplitude-setup-report.md`) is intentionally NOT gitignored —
    // many users want to commit it as part of their analytics docs.
    // Only the wizard-managed archive of the prior report is hidden.
    expect(content).toContain('amplitude-setup-report.previous.md');
    expect(content).not.toMatch(/^amplitude-setup-report\.md$/m);
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
    // Simulate an older wizard version having written a smaller block (with
    // the legacy `.amplitude-events.json` pattern, before this refactor).
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
// archiveSetupReportFile
// ---------------------------------------------------------------------------

describe('archiveSetupReportFile', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  it('renames an existing report to amplitude-setup-report.previous.md', () => {
    const target = path.join(tmpDir, 'amplitude-setup-report.md');
    const archive = path.join(tmpDir, PREVIOUS_SETUP_REPORT_FILENAME);
    fs.writeFileSync(target, '# old report\n', 'utf8');

    archiveSetupReportFile(tmpDir);

    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(archive)).toBe(true);
    // Content is preserved verbatim — archive is a rename, not a copy+rewrite.
    expect(fs.readFileSync(archive, 'utf8')).toBe('# old report\n');
  });

  it('is a no-op when no report exists', () => {
    expect(() => archiveSetupReportFile(tmpDir)).not.toThrow();
    expect(fs.readdirSync(tmpDir)).toHaveLength(0);
  });

  it('overwrites an existing previous.md so only the immediately-prior report is kept', () => {
    const target = path.join(tmpDir, 'amplitude-setup-report.md');
    const archive = path.join(tmpDir, PREVIOUS_SETUP_REPORT_FILENAME);

    // Simulate run N+1: previous.md already holds run N's content; the
    // current report holds run N+1's. Archiving promotes N+1 to previous,
    // and the older run-N content is intentionally rolled off.
    fs.writeFileSync(archive, 'run N (older — should roll off)');
    fs.writeFileSync(target, 'run N+1 (becomes previous)');

    archiveSetupReportFile(tmpDir);

    expect(fs.existsSync(target)).toBe(false);
    expect(fs.readFileSync(archive, 'utf8')).toBe('run N+1 (becomes previous)');
    // Project root holds AT MOST 2 wizard reports — never a growing pile.
    const allReports = fs
      .readdirSync(tmpDir)
      .filter((f) => f.startsWith('amplitude-setup-report'));
    expect(allReports.sort()).toEqual([PREVIOUS_SETUP_REPORT_FILENAME]);
  });

  it('does not touch other files in the install dir', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'amplitude-setup-report.md'), '#');
    archiveSetupReportFile(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, 'package.json'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// restoreSetupReportIfMissing — pairs with archiveSetupReportFile so a
// failed run doesn't bury the user's only report at .previous.md
// ---------------------------------------------------------------------------

describe('restoreSetupReportIfMissing', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  it('restores .previous.md to the canonical path when canonical is absent', () => {
    const target = path.join(tmpDir, 'amplitude-setup-report.md');
    const archive = path.join(tmpDir, PREVIOUS_SETUP_REPORT_FILENAME);
    fs.writeFileSync(archive, '# prior run report\n', 'utf8');

    restoreSetupReportIfMissing(tmpDir);

    expect(fs.existsSync(target)).toBe(true);
    expect(fs.existsSync(archive)).toBe(false);
    expect(fs.readFileSync(target, 'utf8')).toBe('# prior run report\n');
  });

  it('does NOT overwrite a fresh canonical report (success-path safety)', () => {
    const target = path.join(tmpDir, 'amplitude-setup-report.md');
    const archive = path.join(tmpDir, PREVIOUS_SETUP_REPORT_FILENAME);
    // Agent succeeded and wrote a fresh report this run.
    fs.writeFileSync(target, '# fresh from this run\n', 'utf8');
    // Archive from the prior run still on disk.
    fs.writeFileSync(archive, '# stale prior run\n', 'utf8');

    restoreSetupReportIfMissing(tmpDir);

    // Critical: the fresh report must win; archive is preserved untouched.
    expect(fs.readFileSync(target, 'utf8')).toBe('# fresh from this run\n');
    expect(fs.readFileSync(archive, 'utf8')).toBe('# stale prior run\n');
  });

  it('is a no-op when neither the canonical nor the archive exists', () => {
    expect(() => restoreSetupReportIfMissing(tmpDir)).not.toThrow();
    expect(fs.readdirSync(tmpDir)).toHaveLength(0);
  });

  it('archive → restore round-trip preserves prior report on a failed run', () => {
    // End-to-end protection against data loss: the user's prior run
    // produced a report; this run archives it at start, then fails (so
    // no fresh canonical is written). The restore puts the user back
    // exactly where they were.
    const target = path.join(tmpDir, 'amplitude-setup-report.md');
    fs.writeFileSync(target, '# user report from prior run\n', 'utf8');

    archiveSetupReportFile(tmpDir);
    // ... run fails before agent writes a fresh report ...
    restoreSetupReportIfMissing(tmpDir);

    // Canonical content is exactly what the user had before this run.
    expect(fs.readFileSync(target, 'utf8')).toBe(
      '# user report from prior run\n',
    );
    expect(
      fs.existsSync(path.join(tmpDir, PREVIOUS_SETUP_REPORT_FILENAME)),
    ).toBe(false);
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

  it('on success: removes only the single-use integration skill — preserves all data files', () => {
    // Regression: previously deleted .amplitude-events.json (and later
    // .amplitude-dashboard.json) on every exit, breaking resumability and
    // surprising users who wanted those artifacts for re-instrumentation.
    // Current policy: only the single-use integration skill is removed on
    // success; the canonical `.amplitude/` files, the legacy dotfile
    // mirrors, and the user-facing setup report all stay on disk. They're
    // listed in WIZARD_GITIGNORE_PATTERNS so they can't pollute commits.
    const skillDir = path.join(
      tmpDir,
      '.claude',
      'skills',
      'integration-nextjs',
    );
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# nextjs');
    fs.writeFileSync(path.join(tmpDir, '.amplitude-events.json'), '[]');
    fs.writeFileSync(
      path.join(tmpDir, '.amplitude-dashboard.json'),
      '{"dashboardUrl":"https://x"}',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'amplitude-setup-report.md'),
      '# Setup\n',
    );

    cleanupWizardArtifacts(tmpDir, { onSuccess: true });

    // Single-use integration skill removed.
    expect(fs.existsSync(skillDir)).toBe(false);
    // Legacy dotfiles preserved — context-hub skills still read them, and
    // re-instrumentation needs them across runs.
    expect(fs.existsSync(path.join(tmpDir, '.amplitude-events.json'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(tmpDir, '.amplitude-dashboard.json'))).toBe(
      true,
    );
    // Setup report preserved — the user is meant to read it after exit.
    expect(fs.existsSync(path.join(tmpDir, 'amplitude-setup-report.md'))).toBe(
      true,
    );
  });

  it('on cancel/error (no onSuccess): preserves everything, including integration skills', () => {
    // Regression for: a Ctrl+C / wizardAbort / transient error used to
    // wipe .claude/skills/integration-*, forcing a re-download of the
    // SDK-setup skill on re-run. Integration skills now stay so re-run
    // resumes seamlessly. Legacy dotfiles and setup report are also
    // preserved — gitignored, never deleted.
    const skillDir = path.join(
      tmpDir,
      '.claude',
      'skills',
      'integration-nextjs',
    );
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# nextjs');
    fs.writeFileSync(path.join(tmpDir, '.amplitude-events.json'), '[]');
    fs.writeFileSync(
      path.join(tmpDir, '.amplitude-dashboard.json'),
      '{"dashboardUrl":"https://x"}',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'amplitude-setup-report.md'),
      '# Setup\n',
    );

    cleanupWizardArtifacts(tmpDir);

    expect(fs.existsSync(skillDir)).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.amplitude-events.json'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(tmpDir, '.amplitude-dashboard.json'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(tmpDir, 'amplitude-setup-report.md'))).toBe(
      true,
    );
  });

  it('preserves the canonical .amplitude/ dir across cleanup', () => {
    // The canonical paths are intentionally kept across runs — events.json
    // is useful for re-instrumentation, dashboard.json is gitignored under
    // `.amplitude/` so committing isn't a risk.
    const metaDir = path.join(tmpDir, '.amplitude');
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(
      path.join(metaDir, 'events.json'),
      '[{"name":"x","description":"y"}]',
    );
    fs.writeFileSync(
      path.join(metaDir, 'dashboard.json'),
      '{"dashboardUrl":"https://x"}',
    );

    cleanupWizardArtifacts(tmpDir);

    expect(fs.existsSync(path.join(metaDir, 'events.json'))).toBe(true);
    expect(fs.existsSync(path.join(metaDir, 'dashboard.json'))).toBe(true);
  });

  it('still leaves instrumentation and taxonomy skills on disk', () => {
    const keep = [
      'add-analytics-instrumentation',
      'amplitude-chart-dashboard-plan',
      'amplitude-quickstart-taxonomy-agent',
      'wizard-prompt-supplement',
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

// WIZARD_TOOL_NAMES (BA-61)
// ---------------------------------------------------------------------------

describe('WIZARD_TOOL_NAMES', () => {
  // The agent allowedTools list is built from this constant. Adding a tool
  // without registering its name here means the agent cannot call it.

  it('exports the wizard-tools server name', () => {
    expect(WIZARD_TOOLS_SERVER_NAME).toBe('wizard-tools');
  });

  it('includes wizard_feedback so the agent can report blockers', () => {
    expect(WIZARD_TOOL_NAMES).toContain('wizard-tools:wizard_feedback');
  });

  it('includes every currently-exposed wizard-tools tool', () => {
    expect(WIZARD_TOOL_NAMES).toEqual(
      expect.arrayContaining([
        'wizard-tools:check_env_keys',
        'wizard-tools:set_env_values',
        'wizard-tools:detect_package_manager',
        // load_skill_menu / install_skill intentionally absent — see
        // the disabled-tool block in src/lib/wizard-tools.ts
        'wizard-tools:confirm',
        'wizard-tools:choose',
        'wizard-tools:confirm_event_plan',
        'wizard-tools:report_status',
        'wizard-tools:record_dashboard',
        'wizard-tools:wizard_feedback',
      ]),
    );
  });

  it('does not expose disabled skill-menu tools', () => {
    // load_skill_menu / install_skill currently 400 — keep them out of
    // the agent's allowlist until the catalogue / download path is
    // fixed. If this regresses, the agent will start looping on broken
    // tool calls again.
    expect(WIZARD_TOOL_NAMES).not.toContain('wizard-tools:load_skill_menu');
    expect(WIZARD_TOOL_NAMES).not.toContain('wizard-tools:install_skill');
  });

  it('has no duplicate entries', () => {
    expect(new Set(WIZARD_TOOL_NAMES).size).toBe(WIZARD_TOOL_NAMES.length);
  });

  it('every entry is namespaced under the wizard-tools server', () => {
    for (const name of WIZARD_TOOL_NAMES) {
      expect(name.startsWith('wizard-tools:')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// buildFallbackReport
// ---------------------------------------------------------------------------

describe('buildFallbackReport', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  it('renders the wizard-report wrapper and the recap header', () => {
    const md = buildFallbackReport({ installDir: tmpDir });
    expect(md).toContain('<wizard-report>');
    expect(md).toContain('</wizard-report>');
    // Self-disclosing intro so the user knows this is the stub, not the
    // agent's richer report — important for trust.
    expect(md).toContain('generated automatically');
  });

  it('renders an events table when .amplitude-events.json is present', () => {
    persistEventPlan(tmpDir, [
      { name: 'User Signed Up', description: 'Fires after successful signup' },
      { name: 'Checkout Started', description: 'Fires when cart is opened' },
    ]);
    const md = buildFallbackReport({ installDir: tmpDir });
    expect(md).toContain('| Event | Description |');
    expect(md).toContain('User Signed Up');
    expect(md).toContain('Checkout Started');
  });

  it('shows a graceful placeholder when no events were persisted', () => {
    const md = buildFallbackReport({ installDir: tmpDir });
    // Critical: NEVER render an empty Markdown table — looks like a bug.
    expect(md).not.toContain('| Event | Description |');
    expect(md).toContain('No event plan was persisted');
  });

  it('escapes pipe characters inside event names and descriptions', () => {
    persistEventPlan(tmpDir, [
      {
        name: 'Pipe | In Name',
        description: 'Body with | pipe in description',
      },
    ]);
    const md = buildFallbackReport({ installDir: tmpDir });
    expect(md).toContain('Pipe \\| In Name');
    expect(md).toContain('Body with \\| pipe in description');
  });

  it('renders the wizard dashboard open URL when present', () => {
    const canonical =
      'https://app.amplitude.com/analytics/test/dashboard/abc123';
    const md = buildFallbackReport({
      installDir: tmpDir,
      dashboardUrl: canonical,
    });
    expect(md).toContain(toWizardDashboardOpenUrl(canonical));
    expect(md).not.toContain(`Open your dashboard: ${canonical}`);
  });

  it('falls back to a generic Amplitude link when no dashboard URL is captured', () => {
    const md = buildFallbackReport({ installDir: tmpDir });
    expect(md).toContain('https://app.amplitude.com');
    expect(md).toContain("didn't capture a dashboard URL");
  });

  it('mentions the framework / project / env when supplied', () => {
    const md = buildFallbackReport({
      installDir: tmpDir,
      integration: 'nextjs',
      workspaceName: 'Acme Production',
      envName: 'production',
    });
    expect(md).toContain('nextjs');
    expect(md).toContain('Acme Production');
    expect(md).toContain('production');
  });
});

// ---------------------------------------------------------------------------
// writeFallbackReportIfMissing
// ---------------------------------------------------------------------------

describe('writeFallbackReportIfMissing', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  const reportPathFor = (dir: string) =>
    path.join(dir, 'amplitude-setup-report.md');

  it('writes a stub when no report exists', () => {
    const result = writeFallbackReportIfMissing({ installDir: tmpDir });
    expect(result).toBe('fallback-wrote');
    const written = fs.readFileSync(reportPathFor(tmpDir), 'utf8');
    expect(written).toContain('<wizard-report>');
  });

  it('leaves an existing agent-authored report alone (never overwrites)', () => {
    const agentReport = '<wizard-report>\n# AGENT WROTE THIS\n</wizard-report>';
    fs.writeFileSync(reportPathFor(tmpDir), agentReport, 'utf8');

    const result = writeFallbackReportIfMissing({ installDir: tmpDir });
    expect(result).toBe('agent-wrote');

    // Critical invariant: agent's report must not be clobbered.
    const after = fs.readFileSync(reportPathFor(tmpDir), 'utf8');
    expect(after).toBe(agentReport);
  });

  it('returns "failed" without throwing when the install dir is unwritable', () => {
    const result = writeFallbackReportIfMissing({
      installDir: '/dev/null/definitely-not-a-real-dir',
    });
    expect(result).toBe('failed');
  });

  it('renders dashboard link, framework, and events when context is full', () => {
    persistEventPlan(tmpDir, [
      { name: 'User Signed Up', description: 'After signup form submit' },
    ]);

    const canonical = 'https://app.amplitude.com/analytics/x/dashboard/foo';
    const result = writeFallbackReportIfMissing({
      installDir: tmpDir,
      integration: 'nextjs',
      dashboardUrl: canonical,
      workspaceName: 'Acme',
      envName: 'production',
    });
    expect(result).toBe('fallback-wrote');

    const written = fs.readFileSync(reportPathFor(tmpDir), 'utf8');
    expect(written).toContain('User Signed Up');
    expect(written).toContain(toWizardDashboardOpenUrl(canonical));
    expect(written).toContain('nextjs');
    expect(written).toContain('Acme');
  });

  // Failure-path behavior: the agent-runner invokes this function from
  // both the success branch and (post-fix) the cancel/error path. The
  // function itself doesn't know which one called it — it just
  // guarantees a stub when the canonical is empty. PR #316's
  // archiveSetupReportFile step ensures the canonical is either
  // fresh-this-run or absent, so existsSync alone is correct.
  it('writes a stub on the cancel/error path when the canonical is empty', () => {
    // Simulates the wizardAbort registerCleanup hook firing after a
    // cancelled run: archive moved any prior report away at start, no
    // fresh report was written, canonical is empty. The fallback
    // writer must still produce a stub so the outro can surface it.
    const result = writeFallbackReportIfMissing({
      installDir: tmpDir,
      integration: 'nextjs',
    });
    expect(result).toBe('fallback-wrote');
    const written = fs.readFileSync(reportPathFor(tmpDir), 'utf8');
    expect(written).toContain('<wizard-report>');
    expect(written).toContain('nextjs');
  });
});
