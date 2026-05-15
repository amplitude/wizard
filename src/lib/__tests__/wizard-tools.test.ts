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
  persistDraftEventPlan,
  persistDashboard,
  readDraftEventPlanMeta,
  cleanupIntegrationSkills,
  cleanupWizardArtifacts,
  ensureWizardArtifactsIgnored,
  buildFallbackReport,
  writeFallbackReportIfMissing,
  archiveSetupReportFile,
  restoreSetupReportIfMissing,
  normalizeEventName,
  looksLikeIntendedCasing,
  PREVIOUS_SETUP_REPORT_FILENAME,
  WIZARD_GITIGNORE_PATTERNS,
  WIZARD_TOOL_NAMES,
  WIZARD_TOOLS_SERVER_NAME,
  resolveWizardAllowedToolNames,
  bundledSkillExists,
  readBundledSkillBody,
  readBundledSkillReference,
  toWizardToolErrorContent,
  toWizardToolDenyMessage,
} from '../wizard-tools';
import type { WizardToolErrorResponse } from '../wizard-tools';
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
// looksLikeIntendedCasing
// ---------------------------------------------------------------------------
//
// Gate for the `confirm_event_plan` normalizer. The point is to let
// deliberate human casing pass through unchanged — including the
// lowercase variant users sometimes request via plan feedback — while
// still rewriting clearly-programmatic fallbacks (snake_case,
// kebab-case, camelCase, dotted) into Title Case.

describe('looksLikeIntendedCasing', () => {
  it('treats Title Case names with spaces as intended', () => {
    expect(looksLikeIntendedCasing('Collaboration Started')).toBe(true);
    expect(looksLikeIntendedCasing('User Signed Up')).toBe(true);
  });

  it('treats Sentence case names with spaces as intended', () => {
    expect(looksLikeIntendedCasing('Collaboration started')).toBe(true);
  });

  it('treats all-lowercase names with spaces as intended', () => {
    // This is the live-bug case: the user typed `lowercased` as
    // feedback and the agent dutifully revised the plan to lowercase
    // names. Predicate must let them through.
    expect(looksLikeIntendedCasing('collaboration started')).toBe(true);
    expect(looksLikeIntendedCasing('user signed up')).toBe(true);
  });

  it('treats ALL-UPPERCASE names with spaces as intended', () => {
    // Debatable on taste — but it's intentional shouting; not the
    // model dropping back into a programmatic shape. Don't second-guess.
    expect(looksLikeIntendedCasing('COLLABORATION STARTED')).toBe(true);
  });

  it('rejects snake_case as programmatic', () => {
    expect(looksLikeIntendedCasing('user_signed_up')).toBe(false);
    expect(looksLikeIntendedCasing('collaboration_started')).toBe(false);
  });

  it('rejects kebab-case as programmatic', () => {
    expect(looksLikeIntendedCasing('user-signed-up')).toBe(false);
  });

  it('rejects dotted names as programmatic', () => {
    expect(looksLikeIntendedCasing('user.signed.up')).toBe(false);
  });

  it('rejects single-token camelCase / PascalCase as programmatic', () => {
    expect(looksLikeIntendedCasing('userSignedUp')).toBe(false);
    expect(looksLikeIntendedCasing('CollaborationStarted')).toBe(false);
  });

  it('rejects empty / whitespace-only inputs', () => {
    expect(looksLikeIntendedCasing('')).toBe(false);
    expect(looksLikeIntendedCasing('   ')).toBe(false);
  });

  it('accepts multi-word inputs even with stray inner whitespace', () => {
    // Whitespace collapsing happens at the call site; the predicate
    // just needs to recognize the shape as user-intended.
    expect(looksLikeIntendedCasing('  Multi    Spaces  ')).toBe(true);
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

  it('does not create legacy .amplitude-events.json at project root', () => {
    const events = [{ name: 'x', description: 'y' }];
    persistEventPlan(tmpDir, events);
    expect(fs.existsSync(legacy(tmpDir))).toBe(false);
  });

  it('updates canonical only and leaves a pre-existing legacy dotfile unchanged', () => {
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
    expect(parsedCanonical).toEqual([
      { name: 'canonical', description: 'fixed' },
    ]);
    const parsedLegacy = JSON.parse(fs.readFileSync(legacy(tmpDir), 'utf8'));
    expect(parsedLegacy[0].event_name).toBe('External Resource Opened');
    expect(parsedLegacy[0].file_path).toBe('src/app/page.tsx');
  });

  it('returns false when the working directory does not exist', () => {
    const nonexistent = path.join(tmpDir, 'does', 'not', 'exist');
    expect(
      persistEventPlan(nonexistent, [{ name: 'x', description: 'y' }]),
    ).toBe(false);
  });

  it('writes an empty array to canonical when given no events', () => {
    expect(persistEventPlan(tmpDir, [])).toBe(true);
    expect(JSON.parse(fs.readFileSync(canonical(tmpDir), 'utf8'))).toEqual([]);
    expect(fs.existsSync(legacy(tmpDir))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// persistDraftEventPlan — outro safety net for unresolved
// confirm_event_plan feedback. Writes a wrapper-shaped events.json with
// `draft: true` and `lastFeedback`. Refuses to clobber an existing
// non-draft (approved) plan.
// ---------------------------------------------------------------------------

describe('persistDraftEventPlan', () => {
  let tmpDir: string;
  const canonical = (dir: string) =>
    path.join(dir, '.amplitude', 'events.json');

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  it('writes the wrapper shape with draft=true and lastFeedback', () => {
    const events = [
      { name: 'User Signed Up', description: 'when a user signs up' },
    ];
    expect(persistDraftEventPlan(tmpDir, events, 'add a prefix')).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(canonical(tmpDir), 'utf8'));
    expect(parsed).toEqual({
      events: [{ name: 'User Signed Up', description: 'when a user signs up' }],
      draft: true,
      lastFeedback: 'add a prefix',
    });
  });

  it('surfaces the draft to readDraftEventPlanMeta', () => {
    persistDraftEventPlan(
      tmpDir,
      [{ name: 'X', description: 'y' }],
      'rename them all',
    );
    expect(readDraftEventPlanMeta(tmpDir)).toEqual({
      lastFeedback: 'rename them all',
    });
  });

  it('refuses to overwrite an existing approved (plain-array) plan', () => {
    // Simulate a previous successful run that already wrote the
    // canonical plain-array plan.
    persistEventPlan(tmpDir, [
      { name: 'Approved Event', description: 'kept around' },
    ]);

    const ok = persistDraftEventPlan(
      tmpDir,
      [{ name: 'Different Draft', description: 'should NOT land' }],
      'never persisted',
    );
    expect(ok).toBe(false);

    // The original approved plan is still on disk untouched.
    const parsed = JSON.parse(fs.readFileSync(canonical(tmpDir), 'utf8'));
    expect(parsed).toEqual([
      { name: 'Approved Event', description: 'kept around' },
    ]);
    expect(readDraftEventPlanMeta(tmpDir)).toBeNull();
  });

  it('overwrites a previous draft with the latest feedback', () => {
    persistDraftEventPlan(
      tmpDir,
      [{ name: 'First', description: 'x' }],
      'first feedback',
    );
    expect(
      persistDraftEventPlan(
        tmpDir,
        [{ name: 'Second', description: 'y' }],
        'second feedback',
      ),
    ).toBe(true);

    expect(readDraftEventPlanMeta(tmpDir)).toEqual({
      lastFeedback: 'second feedback',
    });
    const parsed = JSON.parse(fs.readFileSync(canonical(tmpDir), 'utf8'));
    expect(parsed.events).toEqual([{ name: 'Second', description: 'y' }]);
  });

  it('returns false when the working directory does not exist', () => {
    const nonexistent = path.join(tmpDir, 'no', 'such', 'dir');
    expect(persistDraftEventPlan(nonexistent, [], 'feedback')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// readDraftEventPlanMeta — null for missing / approved / malformed files
// ---------------------------------------------------------------------------

describe('readDraftEventPlanMeta', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  it('returns null when events.json does not exist', () => {
    expect(readDraftEventPlanMeta(tmpDir)).toBeNull();
  });

  it('returns null when events.json is a regular approved plan', () => {
    persistEventPlan(tmpDir, [{ name: 'Foo', description: 'bar' }]);
    expect(readDraftEventPlanMeta(tmpDir)).toBeNull();
  });

  it('returns null when events.json is malformed JSON', () => {
    const file = path.join(tmpDir, '.amplitude', 'events.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{not json');
    expect(readDraftEventPlanMeta(tmpDir)).toBeNull();
  });

  it('returns the metadata when events.json is a draft wrapper', () => {
    persistDraftEventPlan(
      tmpDir,
      [{ name: 'X', description: 'y' }],
      'fix names',
    );
    expect(readDraftEventPlanMeta(tmpDir)).toEqual({
      lastFeedback: 'fix names',
    });
  });
});

// ---------------------------------------------------------------------------
// buildFallbackReport — surfaces the unresolved-feedback state when the
// outro safety net wrote a draft events.json
// ---------------------------------------------------------------------------

describe('buildFallbackReport (draft events.json)', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  it('surfaces a "feedback was given but plan never finalized" notice when events.json is a draft', () => {
    persistDraftEventPlan(
      tmpDir,
      [
        { name: 'User Signed Up', description: 'signup completes' },
        { name: 'Product Viewed', description: 'PDP mount' },
      ],
      'add a prefix',
    );

    const md = buildFallbackReport({
      installDir: tmpDir,
      integration: 'nextjs',
    });

    // The events still render so the user can see what was proposed
    expect(md).toContain('| `User Signed Up` |');
    expect(md).toContain('| `Product Viewed` |');
    // The unresolved-feedback notice is present
    expect(md).toContain('Feedback was given but the plan was never finalized');
    expect(md).toContain('add a prefix');
    // The "no event plan was persisted" copy must NOT be shown — the
    // events ARE on disk, they just aren't finalized.
    expect(md).not.toContain('No event plan was persisted');
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
    // Dashboard JSON is gitignored; other `.amplitude/*` paths are not blanket-ignored.
    expect(content).toContain('.amplitude/dashboard.json');
    expect(content).not.toMatch(/^\.amplitude\/$/m);
    // Legacy dotfiles stay gitignored for older runs / external tools that
    // may still create them; the wizard writes the canonical plan under
    // `.amplitude/events.json` (see `persistEventPlan`).
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

  it('replaces an older wizard block that used blanket `.amplitude/`', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.gitignore'),
      'node_modules\n# Amplitude wizard\n.amplitude/\n',
      'utf8',
    );
    ensureWizardArtifactsIgnored(tmpDir);
    const content = readGitignore();
    expect(content).not.toMatch(/^\.amplitude\/$/m);
    expect(content).toContain('.amplitude/dashboard.json');
    for (const pattern of WIZARD_GITIGNORE_PATTERNS) {
      expect(content).toContain(pattern);
    }
    expect(content).toContain('node_modules');
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

  it('cancel/failure on a fresh repo leaves canonical absent (#578 regression)', () => {
    // Bug 3: a cancelled run on a fresh repo (no prior report) must NOT
    // write a stub `amplitude-setup-report.md` to the user's project root.
    // Before #578's fix the agent-runner registered the fallback writer as
    // a registerCleanup, so wizardAbort() fired it on every cancel/error
    // and polluted clean working trees. The fix removed that registration
    // — only the priority `restoreSetupReportIfMissing` runs on failure.
    //
    // This test simulates the cancel cleanup queue (priority cleanup =
    // restore; no fallback registration) and asserts the canonical path
    // stays absent when there was nothing to restore.
    expect(fs.readdirSync(tmpDir)).toHaveLength(0);
    archiveSetupReportFile(tmpDir); // no-op: nothing to archive
    // run cancels here — only restore fires (the fix); no fallback.
    restoreSetupReportIfMissing(tmpDir);
    expect(fs.readdirSync(tmpDir)).toHaveLength(0);
    expect(fs.existsSync(path.join(tmpDir, 'amplitude-setup-report.md'))).toBe(
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

  it('on success: removes only the single-use integration skill — preserves all data files', () => {
    // Regression: previously deleted .amplitude-events.json (and later
    // .amplitude-dashboard.json) on every exit, breaking resumability and
    // surprising users who wanted those artifacts for re-instrumentation.
    // Current policy: only the single-use integration skill is removed on
    // success; the canonical `.amplitude/` files, the legacy dotfile
    // mirrors, and the user-facing setup report all stay on disk. They're
    // listed in WIZARD_GITIGNORE_PATTERNS where needed so `git add .`
    // doesn't pick up machine-local or generated paths.
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
    // is useful for re-instrumentation, dashboard.json is gitignored explicitly
    // (`.amplitude/dashboard.json`) so committing isn't a risk for teams that use gitignore.
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
        // PR 2 of DEFER_DASHBOARD_PLAN: registered (additive) so the
        // agent CAN call it. PR 4 wires it into the prompt and retires
        // record_dashboard.
        'wizard-tools:record_dashboard_plan',
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

  it('keeps load_skill opt-in on the static list (use resolveWizardAllowedToolNames)', () => {
    expect(WIZARD_TOOL_NAMES).not.toContain('wizard-tools:load_skill');
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

/**
 * confirm_event_plan tool description — must remind the agent of the
 * two instrumentation-quality contracts the commandments pin:
 *
 *   1. Every `track()` call ships with 1-3 user-meaningful properties.
 *   2. The Setup Report reconciles every approved-plan event into the
 *      Instrumented / Autocaptured / Dropped buckets with totals matching
 *      the plan size.
 *
 * The agent reads the tool description right when it assembles the
 * events array — it's the single most reliable surface to land the
 * reminder. Pin both contracts so a future copy edit can't silently
 * drop one half.
 */
describe('confirm_event_plan tool description — instrumentation contracts', () => {
  it('reminds the agent of the per-track property requirement', async () => {
    const tmpDir = makeTmpDir();
    try {
      const tools = (await getTools(tmpDir)) as Array<{
        name: string;
        description?: string;
        handler: ToolDef['handler'];
      }>;
      const tool = tools.find((t) => t.name === 'confirm_event_plan');
      expect(tool, 'confirm_event_plan must be registered').toBeDefined();
      expect(tool?.description).toContain('1-3 user-meaningful properties');
    } finally {
      cleanup(tmpDir);
    }
  });

  it('reminds the agent of the Setup Report bucket reconciliation', async () => {
    const tmpDir = makeTmpDir();
    try {
      const tools = (await getTools(tmpDir)) as Array<{
        name: string;
        description?: string;
        handler: ToolDef['handler'];
      }>;
      const tool = tools.find((t) => t.name === 'confirm_event_plan');
      expect(tool, 'confirm_event_plan must be registered').toBeDefined();
      expect(tool?.description).toContain('Setup Report');
      expect(tool?.description).toContain(
        'Instrumented / Autocaptured / Dropped',
      );
      // The arithmetic invariant — bucket totals must match the plan size.
      expect(tool?.description).toMatch(/totals matching the plan size/i);
    } finally {
      cleanup(tmpDir);
    }
  });
});

describe('resolveWizardAllowedToolNames', () => {
  const envKey = 'AMPLITUDE_WIZARD_SKILL_TIERS';

  afterEach(() => {
    delete process.env[envKey];
  });

  it('appends load_skill by default (tiers default-on)', () => {
    delete process.env[envKey];
    expect(resolveWizardAllowedToolNames()).toEqual([
      ...WIZARD_TOOL_NAMES,
      'wizard-tools:load_skill_menu',
      'wizard-tools:load_skill',
      'wizard-tools:load_skill_reference',
    ]);
  });

  it('appends load_skill when AMPLITUDE_WIZARD_SKILL_TIERS=1', () => {
    process.env[envKey] = '1';
    expect(resolveWizardAllowedToolNames()).toEqual([
      ...WIZARD_TOOL_NAMES,
      'wizard-tools:load_skill_menu',
      'wizard-tools:load_skill',
      'wizard-tools:load_skill_reference',
    ]);
  });

  it('matches WIZARD_TOOL_NAMES exactly when AMPLITUDE_WIZARD_SKILL_TIERS=0 (escape hatch)', () => {
    process.env[envKey] = '0';
    expect(resolveWizardAllowedToolNames()).toEqual(WIZARD_TOOL_NAMES);
  });
});

describe('readBundledSkillBody', () => {
  it('returns null for traversal-like ids', () => {
    expect(readBundledSkillBody('../etc/passwd')).toBeNull();
  });

  it('returns SKILL.md contents when bundled skill exists', () => {
    const id = 'wizard-prompt-supplement';
    if (!bundledSkillExists(id)) {
      return;
    }
    const body = readBundledSkillBody(id);
    expect(body).toBeTruthy();
    expect(body).toContain('---');
  });
});

describe('readBundledSkillReference', () => {
  it('returns null for traversal-like ids', () => {
    expect(
      readBundledSkillReference('../etc/passwd', 'references/a.md'),
    ).toBeNull();
  });

  it('returns null for non-reference paths', () => {
    expect(
      readBundledSkillReference('wizard-prompt-supplement', 'SKILL.md'),
    ).toBeNull();
  });

  it('returns bundled reference content when present', () => {
    const id = 'wizard-prompt-supplement';
    if (!bundledSkillExists(id)) {
      return;
    }
    const text = readBundledSkillReference(
      id,
      'references/browser-sdk-init-defaults.md',
    );
    expect(text).toBeTruthy();
    expect(text).toContain('Amplitude');
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

  it('renders an events table when the canonical event plan is present', () => {
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

// ---------------------------------------------------------------------------
// Structured tool-error helpers
//
// Pin down the recovery-guidance contract every wizard tool returns on its
// failure paths. The agent SDK forwards `content[0].text` to the model
// verbatim, so the JSON shape here is the model's only signal that the
// failure is recoverable. If a future refactor breaks this shape, the
// agent silently falls back to the "retry the same broken approach 5 times
// → trip the consecutive-deny circuit breaker" behavior these helpers were
// added to fix.
// ---------------------------------------------------------------------------

describe('toWizardToolErrorContent', () => {
  it('emits an MCP content payload with isError set and a JSON body', () => {
    const result = toWizardToolErrorContent({
      error: 'no env file found',
      guidance: 'Create the env file first, then call set_env_values.',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const parsed = JSON.parse(
      result.content[0].text,
    ) as WizardToolErrorResponse;
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('no env file found');
    expect(parsed.guidance).toContain('Create the env file');
  });

  it('preserves optional suggestedTool and suggestedArgs', () => {
    const result = toWizardToolErrorContent({
      error: 'no recognized lockfile',
      guidance: 'Ask the user.',
      suggestedTool: 'mcp__wizard-tools__choose',
      suggestedArgs: { message: 'pick one', options: ['npm', 'pnpm'] },
      context: 'cwd: /tmp/proj',
    });
    const parsed = JSON.parse(
      result.content[0].text,
    ) as WizardToolErrorResponse;
    expect(parsed.suggestedTool).toBe('mcp__wizard-tools__choose');
    expect(parsed.suggestedArgs).toEqual({
      message: 'pick one',
      options: ['npm', 'pnpm'],
    });
    expect(parsed.context).toBe('cwd: /tmp/proj');
  });

  it('always sets success:false (load-bearing for string-matchers in the agent SDK)', () => {
    const result = toWizardToolErrorContent({
      error: 'x',
      guidance: 'y',
    });
    const parsed = JSON.parse(
      result.content[0].text,
    ) as WizardToolErrorResponse;
    // Tests that legacy bundled skills which grep for `success":false` or the
    // word "error" inside a tool-result still see those substrings even
    // though the wrapper is now structured JSON.
    expect(parsed.success).toBe(false);
    expect(result.content[0].text).toContain('"success": false');
    expect(result.content[0].text).toContain('"error":');
  });
});

describe('toWizardToolDenyMessage', () => {
  it('returns a JSON-encoded structured payload as a single string', () => {
    const message = toWizardToolDenyMessage({
      error: 'Bash command denied',
      guidance: 'Use mcp__wizard-tools__check_env_keys.',
      suggestedTool: 'mcp__wizard-tools__check_env_keys',
      context: 'denied command: cat .env',
    });
    // The PreToolUse hook contract requires a string for
    // permissionDecisionReason, not an object. We pre-serialize so the agent
    // sees the same shape on a deny as it does on a tool error.
    expect(typeof message).toBe('string');
    const parsed = JSON.parse(message) as WizardToolErrorResponse;
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('Bash command denied');
    expect(parsed.guidance).toContain('check_env_keys');
    expect(parsed.suggestedTool).toBe('mcp__wizard-tools__check_env_keys');
    expect(parsed.context).toBe('denied command: cat .env');
  });

  it('produces a parseable JSON string even when guidance contains quotes', () => {
    // Regression for the obvious failure mode: deny messages contain shell
    // commands ("cat .env"), single quotes (don't), and code spans
    // (`check_env_keys`). The wrapper must escape them correctly so the
    // agent's JSON.parse() doesn't choke.
    const message = toWizardToolDenyMessage({
      error: 'denied: cat .env',
      guidance: `Use \`check_env_keys\`. Don't retry with "different" quoting.`,
    });
    expect(() => JSON.parse(message)).not.toThrow();
    const parsed = JSON.parse(message) as WizardToolErrorResponse;
    expect(parsed.guidance).toContain('check_env_keys');
  });
});

// ---------------------------------------------------------------------------
// Tool error-path integration
//
// The agent SDK exposes tool definitions as `{name, description, inputSchema,
// handler}` records. We call the handler directly with the same args the
// model would emit, then parse the structured response. This is the
// regression test for the "agent gets actionable guidance" contract.
// ---------------------------------------------------------------------------

interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

interface ToolDef {
  name: string;
  description?: string;
  handler: (args: Record<string, unknown>, extra?: unknown) => unknown;
}

async function callTool(
  tool: ToolDef,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const out = await Promise.resolve(tool.handler(args));
  return out as ToolResult;
}

async function getTools(workingDirectory: string): Promise<ToolDef[]> {
  // The wizard-tools server is built lazily from the SDK's dynamic ESM
  // import. Reach into the unwrapped raw server (Sentry wrapper preserves
  // the `instance` field) to get the underlying tool definitions.
  const { createWizardToolsServer } = await import('../wizard-tools');
  const server = (await createWizardToolsServer({
    workingDirectory,
    detectPackageManager: async (cwd: string) => ({
      detected: [],
      installDir: cwd,
    }),
  })) as { instance?: { _registeredTools?: Record<string, ToolDef> } };

  // The McpServer instance from the SDK exposes registered tools via an
  // internal map. The structure is `_registeredTools[name] = ToolDef`.
  const registered = server.instance?._registeredTools ?? {};
  return Object.values(registered);
}

function findTool(tools: ToolDef[], name: string): ToolDef {
  const t = tools.find((x) => x.name === name);
  if (!t) {
    throw new Error(
      `Tool ${name} not registered; have: ${tools
        .map((x) => x.name)
        .join(', ')}`,
    );
  }
  return t;
}

function parseToolError(result: ToolResult): WizardToolErrorResponse {
  expect(result.isError).toBe(true);
  return JSON.parse(result.content[0].text) as WizardToolErrorResponse;
}

describe('wizard-tools error responses', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  it('check_env_keys returns structured guidance on path traversal', async () => {
    const tools = await getTools(tmpDir);
    const tool = findTool(tools, 'check_env_keys');
    const result = await callTool(tool, {
      filePath: '../etc/passwd',
      keys: ['AMPLITUDE_API_KEY'],
      reason: 'verifying api key',
    });
    const parsed = parseToolError(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('path rejected');
    expect(parsed.guidance).toContain('RELATIVE');
    expect(parsed.suggestedTool).toBe('mcp__wizard-tools__check_env_keys');
  });

  it('check_env_keys returns structured guidance when keys is empty', async () => {
    const tools = await getTools(tmpDir);
    const tool = findTool(tools, 'check_env_keys');
    const result = await callTool(tool, {
      filePath: '.env.local',
      keys: [],
      reason: 'sanity check',
    });
    const parsed = parseToolError(result);
    expect(parsed.error).toContain('no keys requested');
    expect(parsed.guidance).toContain('AMPLITUDE_API_KEY');
  });

  it('set_env_values returns structured guidance on path traversal', async () => {
    const tools = await getTools(tmpDir);
    const tool = findTool(tools, 'set_env_values');
    const result = await callTool(tool, {
      filePath: '../../etc/passwd',
      values: { FOO: 'bar' },
      reason: 'writing env',
    });
    const parsed = parseToolError(result);
    expect(parsed.error).toContain('path rejected');
    expect(parsed.guidance).toContain('RELATIVE');
    expect(parsed.suggestedTool).toBe('mcp__wizard-tools__set_env_values');
  });

  it('set_env_values returns structured guidance when values is empty', async () => {
    const tools = await getTools(tmpDir);
    const tool = findTool(tools, 'set_env_values');
    const result = await callTool(tool, {
      filePath: '.env.local',
      values: {},
      reason: 'no-op call',
    });
    const parsed = parseToolError(result);
    expect(parsed.error).toContain('no values to set');
    expect(parsed.guidance).toContain('key/value pair');
  });

  it('detect_package_manager returns structured guidance when nothing detected', async () => {
    const { createWizardToolsServer } = await import('../wizard-tools');
    const server = (await createWizardToolsServer({
      workingDirectory: tmpDir,
      // Empty detection result — simulates a project with no recognized
      // lockfile / package.json / pyproject.toml.
      detectPackageManager: async (cwd: string) => ({
        detected: [],
        installDir: cwd,
      }),
    })) as { instance?: { _registeredTools?: Record<string, ToolDef> } };
    const tools = Object.values(server.instance?._registeredTools ?? {});
    const tool = findTool(tools, 'detect_package_manager');
    const result = await callTool(tool, { reason: 'before install' });
    const parsed = parseToolError(result);
    expect(parsed.error).toContain('no recognized package manager');
    expect(parsed.guidance).toContain('user');
    expect(parsed.suggestedTool).toBe('mcp__wizard-tools__choose');
    expect(parsed.suggestedArgs).toMatchObject({
      options: expect.arrayContaining(['npm', 'pnpm']),
    });
  });

  it('detect_package_manager surfaces detector errors with recovery guidance', async () => {
    const { createWizardToolsServer } = await import('../wizard-tools');
    const server = (await createWizardToolsServer({
      workingDirectory: tmpDir,
      detectPackageManager: async () => {
        throw new Error('disk read failed');
      },
    })) as { instance?: { _registeredTools?: Record<string, ToolDef> } };
    const tools = Object.values(server.instance?._registeredTools ?? {});
    const tool = findTool(tools, 'detect_package_manager');
    const result = await callTool(tool, { reason: 'before install' });
    const parsed = parseToolError(result);
    expect(parsed.error).toContain('disk read failed');
    expect(parsed.guidance).toContain('user');
    expect(parsed.suggestedTool).toBe('mcp__wizard-tools__choose');
  });
});

// ---------------------------------------------------------------------------
// Policy denials → structured guidance
//
// The PreToolUse hook (createPreToolUseHook) and canUseTool gate
// (wizardCanUseTool) both receive denied tool calls. They now emit the same
// structured payload as the in-process tools, so the "follow guidance, do not
// retry" commandment is uniform across the deny + error paths.
// ---------------------------------------------------------------------------

describe('wizardCanUseTool — structured deny payload', () => {
  let wizardCanUseTool: typeof import('../agent/tool-policy').wizardCanUseTool;

  beforeEach(async () => {
    ({ wizardCanUseTool } = await import('../agent/tool-policy'));
  });

  function parseDeny(message: string): WizardToolErrorResponse {
    return JSON.parse(message) as WizardToolErrorResponse;
  }

  it('Read on .env returns structured deny guidance pointing at check_env_keys', () => {
    const result = wizardCanUseTool('Read', { file_path: '/project/.env' });
    expect(result.behavior).toBe('deny');
    if (result.behavior !== 'deny') return;
    const parsed = parseDeny(result.message);
    expect(parsed.success).toBe(false);
    expect(parsed.suggestedTool).toBe('mcp__wizard-tools__check_env_keys');
    expect(parsed.guidance).toContain('check_env_keys');
    expect(parsed.context).toContain('/project/.env');
  });

  it('Write on .env.local returns structured deny guidance pointing at set_env_values', () => {
    const result = wizardCanUseTool('Write', {
      file_path: '/project/.env.local',
    });
    expect(result.behavior).toBe('deny');
    if (result.behavior !== 'deny') return;
    const parsed = parseDeny(result.message);
    expect(parsed.suggestedTool).toBe('mcp__wizard-tools__set_env_values');
    expect(parsed.guidance).toContain('set_env_values');
  });

  it('Write on .amplitude/events.json returns confirm_event_plan guidance', () => {
    const result = wizardCanUseTool('Write', {
      file_path: '/project/.amplitude/events.json',
    });
    expect(result.behavior).toBe('deny');
    if (result.behavior !== 'deny') return;
    const parsed = parseDeny(result.message);
    expect(parsed.suggestedTool).toBe('mcp__wizard-tools__confirm_event_plan');
    expect(parsed.guidance).toContain('confirm_event_plan');
  });

  it('Bash with dangerous operators returns structured deny', () => {
    const result = wizardCanUseTool('Bash', {
      command: 'echo $(whoami)',
    });
    expect(result.behavior).toBe('deny');
    if (result.behavior !== 'deny') return;
    const parsed = parseDeny(result.message);
    expect(parsed.error).toContain('shell operators');
    expect(parsed.guidance).toContain('check_env_keys');
    expect(parsed.context).toContain('echo $(whoami)');
  });

  it('Bash not in allowlist returns structured deny with suggested fallback', () => {
    const result = wizardCanUseTool('Bash', {
      command: 'cat /etc/passwd',
    });
    expect(result.behavior).toBe('deny');
    if (result.behavior !== 'deny') return;
    const parsed = parseDeny(result.message);
    expect(parsed.error).toContain('package-manager subcommands');
    expect(parsed.guidance).toContain('Read');
    expect(parsed.suggestedTool).toBe('Read');
  });

  it('Grep on .env returns check_env_keys guidance', () => {
    const result = wizardCanUseTool('Grep', { path: '/project/.env' });
    expect(result.behavior).toBe('deny');
    if (result.behavior !== 'deny') return;
    const parsed = parseDeny(result.message);
    expect(parsed.suggestedTool).toBe('mcp__wizard-tools__check_env_keys');
  });
});

// ---------------------------------------------------------------------------
// confirm_event_plan tool description
//
// The tool description is the surface the agent sees most directly when
// deciding what arguments to pass. The Excalidraw run review surfaced a
// failure mode where the agent proposed 14 events, 8 of which the Setup
// Report later flagged as "covered by autocapture — no track() needed."
// The fix is upstream: refuse to propose events that autocapture handles.
// The wizard commandments carry the full catalog; the tool description
// mirrors the rule so the agent sees it at the moment of decision.
// ---------------------------------------------------------------------------

describe('confirm_event_plan tool description', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  it('instructs the agent to filter out autocapture-covered events before calling', async () => {
    const tools = await getTools(tmpDir);
    const tool = findTool(tools, 'confirm_event_plan');
    expect(tool.description).toBeDefined();
    const desc = tool.description ?? '';
    // The filter-first imperative — verbatim sentinel so a future copy
    // edit can't quietly drop the rule and leave only the commandment.
    expect(desc).toMatch(/BEFORE calling this tool, filter out/i);
    // Names the families of autocaptured events so the agent has
    // concrete examples to match against its candidate plan.
    expect(desc).toContain('element clicks');
    expect(desc).toContain('form submits');
    expect(desc).toContain('page views');
    expect(desc).toContain('session start');
    expect(desc).toContain('rage');
    // The "if autocapture handles it, do NOT include it" formulation is
    // what closes the include-with-a-note loophole at the tool layer.
    expect(desc).toMatch(/do NOT include it/);
    // Points the agent back at the commandments for the full catalog so
    // the tool description stays terse but the rule stays discoverable.
    expect(desc).toMatch(/wizard commandments|autocapture catalog/i);
  });
});

// ---------------------------------------------------------------------------
// isWizardPromptActive / onWizardPromptRelease
//
// Regression coverage for the false-positive stall reported by the user on
// Excalidraw: `confirm_event_plan` blocks server-side on `promptEventPlan`,
// no SDK message arrives while the user reads the plan, and the 60s stall
// detector in agent-interface.ts fires. The wizard-tools side of the fix
// tracks an "active prompt" flag for the three blocking prompt tools so the
// stall detector can suppress the abort while waiting on a human.
// ---------------------------------------------------------------------------

describe('isWizardPromptActive / onWizardPromptRelease', () => {
  let isWizardPromptActive: typeof import('../wizard-tools').isWizardPromptActive;
  let onWizardPromptRelease: typeof import('../wizard-tools').onWizardPromptRelease;
  let __resetWizardPromptStateForTests: typeof import('../wizard-tools').__resetWizardPromptStateForTests;
  let setUI: typeof import('../../ui').setUI;
  let LoggingUI: typeof import('../../ui/logging-ui').LoggingUI;

  beforeEach(async () => {
    ({
      isWizardPromptActive,
      onWizardPromptRelease,
      __resetWizardPromptStateForTests,
    } = await import('../wizard-tools'));
    ({ setUI } = await import('../../ui'));
    ({ LoggingUI } = await import('../../ui/logging-ui'));
    __resetWizardPromptStateForTests();
  });

  afterEach(() => {
    __resetWizardPromptStateForTests();
    // Restore default UI so other suites that rely on `getUI()` see a clean
    // LoggingUI singleton. `setUI` always replaces — there's no `clearUI`.
    setUI(new LoggingUI());
  });

  // Build a fake UI whose prompt methods return a Promise we control. Lets us
  // observe the active-prompt window from the test (set→assert→resolve).
  function makeDeferredPromptUI<T>(value: T): {
    ui: import('../../ui').WizardUI;
    resolve: () => void;
    reject: (err: Error) => void;
  } {
    let resolveFn: () => void = () => {};
    let rejectFn: (err: Error) => void = () => {};
    const pending = new Promise<T>((res, rej) => {
      resolveFn = () => res(value);
      rejectFn = rej;
    });
    const ui = new LoggingUI();
    // Override prompt methods to block on `pending`.
    ui.promptConfirm = () => pending as unknown as Promise<boolean>;
    ui.promptChoice = () => pending as unknown as Promise<string>;
    ui.promptEventPlan = () =>
      pending as unknown as Promise<
        import('../../ui/wizard-ui').EventPlanDecision
      >;
    return { ui, resolve: resolveFn, reject: rejectFn };
  }

  async function getPromptTools(): Promise<{
    confirmTool: ToolDef;
    chooseTool: ToolDef;
    confirmEventPlanTool: ToolDef;
  }> {
    const tmpDir = makeTmpDir();
    try {
      const tools = await getTools(tmpDir);
      return {
        confirmTool: findTool(tools, 'confirm'),
        chooseTool: findTool(tools, 'choose'),
        confirmEventPlanTool: findTool(tools, 'confirm_event_plan'),
      };
    } finally {
      cleanup(tmpDir);
    }
  }

  it('reports false when no prompt is in flight', () => {
    expect(isWizardPromptActive()).toBe(false);
  });

  it('flips to true while confirm awaits the user, then back to false', async () => {
    const { ui, resolve } = makeDeferredPromptUI(true);
    setUI(ui);
    const { confirmTool } = await getPromptTools();

    // Fire the tool but do not await it — the user prompt is "open" until
    // we resolve the deferred pending promise.
    const inFlight = callTool(confirmTool, {
      message: 'proceed?',
      reason: 'unit test',
    });
    expect(await waitForPromptActive()).toBe(true);

    resolve();
    await inFlight;
    expect(isWizardPromptActive()).toBe(false);
  });

  // Poll until the prompt-active flag flips on, with a short cap. Tool
  // handlers may walk through several internal awaits (e.g. a dynamic
  // `await import('./constants.js')` inside `confirm_event_plan`) before
  // reaching the UI prompt — a fixed microtask flush is racy.
  async function waitForPromptActive(timeoutMs = 1000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (isWizardPromptActive()) return true;
      await new Promise<void>((res) => setImmediate(res));
    }
    return isWizardPromptActive();
  }

  it('flips for choose and confirm_event_plan as well', async () => {
    {
      const { ui, resolve } = makeDeferredPromptUI('opt-a');
      setUI(ui);
      const { chooseTool } = await getPromptTools();
      const inFlight = callTool(chooseTool, {
        message: 'pick',
        options: ['opt-a', 'opt-b'],
        reason: 'unit test',
      });
      expect(await waitForPromptActive()).toBe(true);
      resolve();
      await inFlight;
      expect(isWizardPromptActive()).toBe(false);
    }

    {
      const { ui, resolve } = makeDeferredPromptUI({
        decision: 'approved' as const,
      });
      setUI(ui);
      const { confirmEventPlanTool } = await getPromptTools();
      const inFlight = callTool(confirmEventPlanTool, {
        events: [{ name: 'Test Event Fired', description: 'fires on test' }],
        reason: 'unit test',
      });
      expect(await waitForPromptActive()).toBe(true);
      resolve();
      await inFlight;
      expect(isWizardPromptActive()).toBe(false);
    }
  });

  it('release listener fires on the 1→0 transition when prompt resolves', async () => {
    const { ui, resolve } = makeDeferredPromptUI(true);
    setUI(ui);
    const { confirmTool } = await getPromptTools();

    let releaseCount = 0;
    const unsubscribe = onWizardPromptRelease(() => {
      releaseCount++;
    });

    const inFlight = callTool(confirmTool, {
      message: 'proceed?',
      reason: 'unit test',
    });
    expect(await waitForPromptActive()).toBe(true);
    expect(releaseCount).toBe(0); // still in flight
    resolve();
    await inFlight;
    expect(releaseCount).toBe(1);
    expect(isWizardPromptActive()).toBe(false);
    unsubscribe();
  });

  it('handles nested prompts — release only fires on outermost resolve', async () => {
    // Two concurrent prompts in flight. Even though only one is fielded at
    // a time in production, defending against the case keeps the flag
    // honest if a future code path layers them. The release listener must
    // fire exactly once, on the 1→0 edge, not after each individual prompt.
    const outer = makeDeferredPromptUI(true);
    const inner = makeDeferredPromptUI('opt-a');

    let releaseCount = 0;
    const unsubscribe = onWizardPromptRelease(() => {
      releaseCount++;
    });

    setUI(outer.ui);
    const { confirmTool, chooseTool } = await getPromptTools();
    const outerCall = callTool(confirmTool, {
      message: 'outer',
      reason: 'unit test',
    });
    expect(await waitForPromptActive()).toBe(true);

    // Swap to the inner UI so the choose tool's prompt resolves on its own
    // deferred. (The factory is per-call: the tool reads `getUI()` afresh.)
    setUI(inner.ui);
    const innerCall = callTool(chooseTool, {
      message: 'inner',
      options: ['opt-a', 'opt-b'],
      reason: 'unit test',
    });
    // Yield enough macrotasks for the second handler to enter its
    // active-prompt window. We can't directly inspect the counter, but the
    // outer flag is already true and only flips off when ALL prompts close.
    for (let i = 0; i < 50; i++) {
      await new Promise<void>((res) => setImmediate(res));
    }
    expect(isWizardPromptActive()).toBe(true);

    // Resolve the inner prompt first — flag stays true (outer still open).
    inner.resolve();
    await innerCall;
    expect(isWizardPromptActive()).toBe(true);
    expect(releaseCount).toBe(0);

    // Now resolve the outer — flag flips and listener fires once.
    outer.resolve();
    await outerCall;
    expect(isWizardPromptActive()).toBe(false);
    expect(releaseCount).toBe(1);
    unsubscribe();
  });

  it('clears the flag even when the prompt rejects (try/finally)', async () => {
    const { ui, reject } = makeDeferredPromptUI(true);
    setUI(ui);
    const { confirmTool } = await getPromptTools();

    let releaseCount = 0;
    const unsubscribe = onWizardPromptRelease(() => {
      releaseCount++;
    });

    const inFlight = callTool(confirmTool, {
      message: 'proceed?',
      reason: 'unit test',
    });
    expect(await waitForPromptActive()).toBe(true);

    reject(new Error('user closed terminal'));
    // The tool handler awaits the prompt and lets the rejection propagate;
    // the test treats it as expected.
    await expect(inFlight).rejects.toThrow('user closed terminal');
    expect(isWizardPromptActive()).toBe(false);
    expect(releaseCount).toBe(1);
    unsubscribe();
  });

  it('unsubscribe stops further release notifications', async () => {
    let releaseCount = 0;
    const unsubscribe = onWizardPromptRelease(() => {
      releaseCount++;
    });
    unsubscribe();

    const { ui, resolve } = makeDeferredPromptUI(true);
    setUI(ui);
    const { confirmTool } = await getPromptTools();
    const inFlight = callTool(confirmTool, {
      message: 'proceed?',
      reason: 'unit test',
    });
    expect(await waitForPromptActive()).toBe(true);
    resolve();
    await inFlight;
    expect(releaseCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// confirm_event_plan → persisted name casing (gated normalizer)
// ---------------------------------------------------------------------------
//
// End-to-end pinning of the live bug. The agent calls the tool with a
// proposed plan, the wizard prompts the user, the user approves, and the
// canonical events.json is written. Pre-fix this path silently
// re-Title-Cased every entry — so user feedback like "use lowercase" was
// structurally impossible to honor. Post-fix:
//   - intentional casing (Title, Sentence, lower, shouty) survives intact
//   - programmatic shapes (snake_case, camelCase, etc.) still normalize.

describe('confirm_event_plan name-casing flow', () => {
  let tmpDir: string;
  let setUI: typeof import('../../ui').setUI;
  let LoggingUI: typeof import('../../ui/logging-ui').LoggingUI;

  beforeEach(async () => {
    tmpDir = makeTmpDir();
    ({ setUI } = await import('../../ui'));
    ({ LoggingUI } = await import('../../ui/logging-ui'));
  });
  afterEach(() => {
    cleanup(tmpDir);
    // Restore a fresh LoggingUI so neighbouring suites see a clean singleton.
    setUI(new LoggingUI());
  });

  function makeAutoApproveUI(): import('../../ui').WizardUI {
    const ui = new LoggingUI();
    ui.promptEventPlan = async () =>
      ({
        decision: 'approved',
      } as import('../../ui/wizard-ui').EventPlanDecision);
    return ui;
  }

  async function runConfirmEventPlan(
    events: Array<{ name: string; description: string }>,
  ): Promise<Array<{ name: string; description: string }>> {
    setUI(makeAutoApproveUI());
    const tools = await getTools(tmpDir);
    const tool = findTool(tools, 'confirm_event_plan');
    await callTool(tool, { events, reason: 'unit test' });
    const raw = fs.readFileSync(
      path.join(tmpDir, '.amplitude', 'events.json'),
      'utf8',
    );
    return JSON.parse(raw) as Array<{ name: string; description: string }>;
  }

  it('preserves all-lowercase names the user asked for via feedback', async () => {
    // Pin for the Excalidraw bug: user typed `lowercased` as plan
    // feedback, agent revised to lowercase names, normalizer used to
    // rewrite them back to Title Case so the "revised" plan came back
    // identical. Must survive verbatim now.
    const persisted = await runConfirmEventPlan([
      { name: 'collaboration started', description: 'A collab opens' },
      { name: 'shape created', description: 'User drops a shape' },
    ]);
    expect(persisted).toEqual([
      { name: 'collaboration started', description: 'A collab opens' },
      { name: 'shape created', description: 'User drops a shape' },
    ]);
  });

  it('still normalizes programmatic snake_case fallbacks to Title Case', async () => {
    const persisted = await runConfirmEventPlan([
      { name: 'user_signed_up', description: 'Signup completes' },
    ]);
    expect(persisted).toEqual([
      { name: 'User Signed Up', description: 'Signup completes' },
    ]);
  });

  it('still normalizes camelCase fallbacks to Title Case', async () => {
    const persisted = await runConfirmEventPlan([
      { name: 'userSignedUp', description: 'Signup completes' },
    ]);
    expect(persisted).toEqual([
      { name: 'User Signed Up', description: 'Signup completes' },
    ]);
  });

  it('preserves Title Case and Sentence case unchanged', async () => {
    const persisted = await runConfirmEventPlan([
      { name: 'User Signed Up', description: 'Title Case stays' },
      { name: 'User signed up', description: 'Sentence case stays' },
    ]);
    expect(persisted).toEqual([
      { name: 'User Signed Up', description: 'Title Case stays' },
      { name: 'User signed up', description: 'Sentence case stays' },
    ]);
  });

  it('collapses extra whitespace inside otherwise-intended names', async () => {
    const persisted = await runConfirmEventPlan([
      { name: '  Multi    Spaces  ', description: 'whitespace collapsed' },
    ]);
    expect(persisted).toEqual([
      { name: 'Multi Spaces', description: 'whitespace collapsed' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// set_agent_tasks / update_agent_task — the agent's self-reported task list
//
// These tools let the inner agent declare a plan at the start of every run
// and update each row as work progresses. The wizard renders the list below
// the canonical 4-step skeleton so users see what the agent itself is
// thinking, not just the wizard's scaffolding.
// ---------------------------------------------------------------------------

describe('set_agent_tasks / update_agent_task', () => {
  let setUI: typeof import('../../ui').setUI;
  let LoggingUI: typeof import('../../ui/logging-ui').LoggingUI;
  let __resetFirstAgentPlanForTests: typeof import('../wizard-tools').__resetFirstAgentPlanForTests;
  let tmpDir: string;

  beforeEach(async () => {
    ({ setUI } = await import('../../ui'));
    ({ LoggingUI } = await import('../../ui/logging-ui'));
    ({ __resetFirstAgentPlanForTests } = await import('../wizard-tools'));
    __resetFirstAgentPlanForTests();
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    __resetFirstAgentPlanForTests();
    setUI(new LoggingUI());
    cleanup(tmpDir);
  });

  // Capture-UI: records every setAgentTasks / updateAgentTask call so the
  // test can assert atom-equivalent behavior without spinning up the InkUI
  // store. This is the same pattern other UI-coupled tool tests use.
  function makeCaptureUI() {
    const setCalls: Array<
      Array<{
        id: string;
        title: string;
        status: 'pending' | 'in_progress' | 'done';
      }>
    > = [];
    const updateCalls: Array<{
      id: string;
      status: 'pending' | 'in_progress' | 'done';
      title?: string;
    }> = [];
    const list: Array<{
      id: string;
      title: string;
      status: 'pending' | 'in_progress' | 'done';
    }> = [];
    const ui = new LoggingUI();
    ui.setAgentTasks = (tasks) => {
      setCalls.push(tasks.map((t) => ({ ...t })));
      list.length = 0;
      for (const t of tasks) list.push({ ...t });
    };
    ui.updateAgentTask = (id, patch) => {
      updateCalls.push({ ...patch, id });
      const idx = list.findIndex((t) => t.id === id);
      if (idx === -1) return false;
      list[idx] = {
        ...list[idx],
        status: patch.status,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
      };
      return true;
    };
    return { ui, setCalls, updateCalls, list };
  }

  it('set_agent_tasks records the full task list and forwards it to the UI', async () => {
    const capture = makeCaptureUI();
    setUI(capture.ui);
    const tools = await getTools(tmpDir);
    const tool = findTool(tools, 'set_agent_tasks');

    const result = await callTool(tool, {
      tasks: [
        { id: 'a', title: 'Add SDK import', status: 'pending' },
        { id: 'b', title: 'Initialize SDK', status: 'in_progress' },
        { id: 'c', title: 'Wire signup track call', status: 'pending' },
      ],
      reason: 'declaring initial plan after discovery',
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe('ok: 3 tasks');
    expect(capture.setCalls).toHaveLength(1);
    expect(capture.setCalls[0]).toEqual([
      { id: 'a', title: 'Add SDK import', status: 'pending' },
      { id: 'b', title: 'Initialize SDK', status: 'in_progress' },
      { id: 'c', title: 'Wire signup track call', status: 'pending' },
    ]);
  });

  it('set_agent_tasks rejects duplicate task ids', async () => {
    setUI(makeCaptureUI().ui);
    const tools = await getTools(tmpDir);
    const tool = findTool(tools, 'set_agent_tasks');

    const result = await callTool(tool, {
      tasks: [
        { id: 'dup', title: 'first', status: 'pending' },
        { id: 'dup', title: 'second', status: 'pending' },
      ],
      reason: 'should fail',
    });
    const parsed = parseToolError(result);
    expect(parsed.error).toContain('duplicate task id');
    expect(parsed.suggestedTool).toBe('mcp__wizard-tools__set_agent_tasks');
  });

  // -------------------------------------------------------------------------
  // Schema-level validation (Zod). The SDK runs `inputSchema.parse()` before
  // calling the handler at the agent boundary, so unit tests that invoke
  // `tool.handler` directly bypass it. The inputSchema is captured as a
  // record of named Zod fields on the registered tool — we wrap it in a
  // `z.object(...)` to exercise the same parse path the SDK would.
  // -------------------------------------------------------------------------

  async function getSetAgentTasksZodObject() {
    const { z: zod } = await import('zod');
    const tools = await getTools(tmpDir);
    const tool = findTool(tools, 'set_agent_tasks') as ToolDef & {
      inputSchema?: Record<string, unknown>;
    };
    expect(tool.inputSchema).toBeTruthy();
    return zod.object(tool.inputSchema as Parameters<typeof zod.object>[0]);
  }

  it('set_agent_tasks input schema rejects an empty list', async () => {
    setUI(makeCaptureUI().ui);
    const schema = await getSetAgentTasksZodObject();
    const parsed = schema.safeParse({
      tasks: [],
      reason: 'empty plan should fail',
    });
    expect(parsed.success).toBe(false);
  });

  it('set_agent_tasks input schema rejects a missing title', async () => {
    setUI(makeCaptureUI().ui);
    const schema = await getSetAgentTasksZodObject();
    const parsed = schema.safeParse({
      tasks: [{ id: 'a', status: 'pending' }],
      reason: 'malformed should fail',
    });
    expect(parsed.success).toBe(false);
  });

  it('set_agent_tasks input schema rejects an invalid status enum', async () => {
    setUI(makeCaptureUI().ui);
    const schema = await getSetAgentTasksZodObject();
    const parsed = schema.safeParse({
      tasks: [{ id: 'a', title: 'broken', status: 'completed' }],
      reason: 'invalid status should fail',
    });
    expect(parsed.success).toBe(false);
  });

  it('update_agent_task patches the matching row', async () => {
    const capture = makeCaptureUI();
    setUI(capture.ui);
    const tools = await getTools(tmpDir);
    const setTool = findTool(tools, 'set_agent_tasks');
    const updateTool = findTool(tools, 'update_agent_task');

    await callTool(setTool, {
      tasks: [{ id: 'init', title: 'Initialize SDK', status: 'pending' }],
      reason: 'seed',
    });

    const result = await callTool(updateTool, {
      id: 'init',
      status: 'in_progress',
      reason: 'starting init',
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe('ok');
    expect(capture.list[0]).toEqual({
      id: 'init',
      title: 'Initialize SDK',
      status: 'in_progress',
    });
  });

  it('update_agent_task can refine the title alongside the status', async () => {
    const capture = makeCaptureUI();
    setUI(capture.ui);
    const tools = await getTools(tmpDir);
    const setTool = findTool(tools, 'set_agent_tasks');
    const updateTool = findTool(tools, 'update_agent_task');

    await callTool(setTool, {
      tasks: [{ id: 'wire', title: 'Wire signup', status: 'pending' }],
      reason: 'seed',
    });
    await callTool(updateTool, {
      id: 'wire',
      status: 'in_progress',
      title: 'Wire signup -> SignupForm.tsx onSubmit',
      reason: 'refined title',
    });
    expect(capture.list[0].title).toBe(
      'Wire signup -> SignupForm.tsx onSubmit',
    );
    expect(capture.list[0].status).toBe('in_progress');
  });

  it('update_agent_task returns guidance when the id is unknown', async () => {
    const capture = makeCaptureUI();
    setUI(capture.ui);
    const tools = await getTools(tmpDir);
    const tool = findTool(tools, 'update_agent_task');

    const result = await callTool(tool, {
      id: 'never-declared',
      status: 'done',
      reason: 'should fail',
    });
    const parsed = parseToolError(result);
    expect(parsed.error).toContain('unknown task id');
    expect(parsed.suggestedTool).toBe('mcp__wizard-tools__set_agent_tasks');
    expect(parsed.guidance).toContain('set_agent_tasks');
  });

  it('set_agent_tasks is idempotent — calling twice replaces the list', async () => {
    const capture = makeCaptureUI();
    setUI(capture.ui);
    const tools = await getTools(tmpDir);
    const setTool = findTool(tools, 'set_agent_tasks');

    await callTool(setTool, {
      tasks: [{ id: 'a', title: 'first plan', status: 'pending' }],
      reason: 'initial plan',
    });
    await callTool(setTool, {
      tasks: [
        { id: 'x', title: 'revised step 1', status: 'in_progress' },
        { id: 'y', title: 'revised step 2', status: 'pending' },
      ],
      reason: 'discovered another file to wire',
    });
    expect(capture.setCalls).toHaveLength(2);
    expect(capture.list).toEqual([
      { id: 'x', title: 'revised step 1', status: 'in_progress' },
      { id: 'y', title: 'revised step 2', status: 'pending' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Integration-style — agent calls set_agent_tasks then update_agent_task
// twice, the in-memory store reflects each transition.
// ---------------------------------------------------------------------------

describe('agent task list — end-to-end through WizardStore', () => {
  let setUI: typeof import('../../ui').setUI;
  let LoggingUI: typeof import('../../ui/logging-ui').LoggingUI;
  let InkUI: typeof import('../../ui/tui/ink-ui').InkUI;
  let WizardStore: typeof import('../../ui/tui/store').WizardStore;
  let __resetFirstAgentPlanForTests: typeof import('../wizard-tools').__resetFirstAgentPlanForTests;
  let tmpDir: string;

  beforeEach(async () => {
    ({ setUI } = await import('../../ui'));
    ({ LoggingUI } = await import('../../ui/logging-ui'));
    ({ InkUI } = await import('../../ui/tui/ink-ui'));
    ({ WizardStore } = await import('../../ui/tui/store'));
    ({ __resetFirstAgentPlanForTests } = await import('../wizard-tools'));
    __resetFirstAgentPlanForTests();
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    __resetFirstAgentPlanForTests();
    setUI(new LoggingUI());
    cleanup(tmpDir);
  });

  it('declares a plan then transitions two rows visibly through the store', async () => {
    const store = new WizardStore();
    setUI(new InkUI(store));
    const tools = await getTools(tmpDir);
    const setTool = findTool(tools, 'set_agent_tasks');
    const updateTool = findTool(tools, 'update_agent_task');

    // The agent inspects the codebase and declares its plan.
    await callTool(setTool, {
      tasks: [
        {
          id: 'install',
          title: 'pnpm add @amplitude/unified',
          status: 'pending',
        },
        {
          id: 'init',
          title: 'Initialize SDK in src/main.tsx',
          status: 'pending',
        },
        {
          id: 'wire',
          title: 'Wire signup track call',
          status: 'pending',
        },
      ],
      reason: 'initial plan after discovery',
    });
    expect(store.agentTasks.map((t) => t.status)).toEqual([
      'pending',
      'pending',
      'pending',
    ]);

    // First transition: install begins.
    await callTool(updateTool, {
      id: 'install',
      status: 'in_progress',
      reason: 'starting install',
    });
    expect(store.agentTasks.find((t) => t.id === 'install')?.status).toBe(
      'in_progress',
    );

    // Second transition: install finishes, init begins.
    await callTool(updateTool, {
      id: 'install',
      status: 'done',
      reason: 'install complete',
    });
    await callTool(updateTool, {
      id: 'init',
      status: 'in_progress',
      reason: 'starting init',
    });
    expect(store.agentTasks.find((t) => t.id === 'install')?.status).toBe(
      'done',
    );
    expect(store.agentTasks.find((t) => t.id === 'init')?.status).toBe(
      'in_progress',
    );
    expect(store.agentTasks.find((t) => t.id === 'wire')?.status).toBe(
      'pending',
    );
  });
});
