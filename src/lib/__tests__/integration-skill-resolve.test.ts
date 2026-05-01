import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Integration } from '../constants';
import {
  listIntegrationSkillIdsOnDisk,
  filterIntegrationSkillIdsForIntegration,
  resolveIntegrationSkillId,
} from '../integration-skill-resolve';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-int-skill-'));
}

function touchSkill(installDir: string, skillId: string): void {
  const dir = path.join(installDir, '.claude', 'skills', skillId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    '---\nname: ' + skillId + '\n---\n',
    'utf8',
  );
}

describe('listIntegrationSkillIdsOnDisk', () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmpDir();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty when .claude/skills is missing', () => {
    expect(listIntegrationSkillIdsOnDisk(dir)).toEqual([]);
  });

  it('ignores dirs without SKILL.md', () => {
    fs.mkdirSync(path.join(dir, '.claude', 'skills', 'integration-foo'), {
      recursive: true,
    });
    expect(listIntegrationSkillIdsOnDisk(dir)).toEqual([]);
  });

  it('returns sorted integration-* ids with SKILL.md', () => {
    touchSkill(dir, 'integration-zebra');
    touchSkill(dir, 'integration-apple');
    touchSkill(dir, 'not-integration');
    expect(listIntegrationSkillIdsOnDisk(dir)).toEqual([
      'integration-apple',
      'integration-zebra',
    ]);
  });
});

describe('filterIntegrationSkillIdsForIntegration', () => {
  it('scopes nextjs to integration-nextjs-*', () => {
    const ids = [
      'integration-django',
      'integration-nextjs-pages-router',
      'integration-nextjs-app-router',
    ];
    const scoped = filterIntegrationSkillIdsForIntegration('nextjs', ids);
    expect(scoped).toEqual([
      'integration-nextjs-app-router',
      'integration-nextjs-pages-router',
    ]);
  });

  it('scopes react-router stack ids', () => {
    const ids = [
      'integration-django',
      'integration-react-react-router-6',
      'integration-tanstack-start',
    ];
    const scoped = filterIntegrationSkillIdsForIntegration('react-router', ids);
    expect(scoped).toEqual([
      'integration-react-react-router-6',
      'integration-tanstack-start',
    ]);
  });
});

describe('resolveIntegrationSkillId', () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmpDir();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when there are zero candidates', () => {
    expect(
      resolveIntegrationSkillId({
        integration: Integration.nextjs,
        primaryBundledId: null,
        frameworkContext: {},
        candidateSkillIds: [],
      }),
    ).toBeNull();
  });

  it('returns the only disk id (single_candidate)', () => {
    touchSkill(dir, 'integration-django');
    const disk = listIntegrationSkillIdsOnDisk(dir);
    const r = resolveIntegrationSkillId({
      integration: Integration.django,
      primaryBundledId: null,
      frameworkContext: {},
      candidateSkillIds: disk,
    });
    expect(r).toEqual({
      skillId: 'integration-django',
      source: 'single_candidate',
    });
  });

  it('prefers primaryBundledId when present in scoped pool (primary_on_disk)', () => {
    touchSkill(dir, 'integration-nextjs-app-router');
    touchSkill(dir, 'integration-nextjs-pages-router');
    const disk = listIntegrationSkillIdsOnDisk(dir);
    const r = resolveIntegrationSkillId({
      integration: Integration.nextjs,
      primaryBundledId: 'integration-nextjs-pages-router',
      frameworkContext: { router: 'app-router' },
      candidateSkillIds: disk,
    });
    expect(r).toEqual({
      skillId: 'integration-nextjs-pages-router',
      source: 'primary_on_disk',
    });
  });

  it('uses Next.js router hint over lexicographic order (framework_hint)', () => {
    touchSkill(dir, 'integration-nextjs-app-router');
    touchSkill(dir, 'integration-nextjs-pages-router');
    const disk = listIntegrationSkillIdsOnDisk(dir);
    const r = resolveIntegrationSkillId({
      integration: Integration.nextjs,
      primaryBundledId: null,
      frameworkContext: { router: 'pages-router' },
      candidateSkillIds: disk,
    });
    expect(r).toEqual({
      skillId: 'integration-nextjs-pages-router',
      source: 'framework_hint',
    });
  });

  it('uses React Router routerMode hint (framework_hint)', () => {
    touchSkill(dir, 'integration-react-react-router-6');
    touchSkill(dir, 'integration-react-react-router-7-data');
    const disk = listIntegrationSkillIdsOnDisk(dir);
    const r = resolveIntegrationSkillId({
      integration: Integration.reactRouter,
      primaryBundledId: null,
      frameworkContext: { routerMode: 'v7-data' },
      candidateSkillIds: disk,
    });
    expect(r).toEqual({
      skillId: 'integration-react-react-router-7-data',
      source: 'framework_hint',
    });
  });

  it('tie-breaks lexicographically when no primary and no hint (lexicographic_tiebreak)', () => {
    touchSkill(dir, 'integration-react-tanstack-router-code-based');
    touchSkill(dir, 'integration-react-tanstack-router-file-based');
    const disk = listIntegrationSkillIdsOnDisk(dir);
    const r = resolveIntegrationSkillId({
      integration: Integration.reactRouter,
      primaryBundledId: null,
      frameworkContext: {},
      candidateSkillIds: disk,
    });
    expect(r?.source).toBe('lexicographic_tiebreak');
    expect(r?.skillId).toBe('integration-react-tanstack-router-code-based');
  });

  it('falls back to full disk list when integration filter matches nothing', () => {
    touchSkill(dir, 'integration-django');
    touchSkill(dir, 'integration-flask');
    const disk = listIntegrationSkillIdsOnDisk(dir);
    const r = resolveIntegrationSkillId({
      integration: Integration.nextjs,
      primaryBundledId: null,
      frameworkContext: {},
      candidateSkillIds: disk,
    });
    expect(r?.source).toBe('lexicographic_tiebreak');
    expect(r?.skillId).toBe('integration-django');
  });
});
