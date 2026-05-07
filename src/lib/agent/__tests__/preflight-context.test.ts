/**
 * Unit tests for `buildPreflightContext`.
 *
 * Locks the contract that the helper:
 *   - Always renders all three sections (Project / Amplitude state /
 *     Environment) so the agent can rely on a stable shape.
 *   - Reports key PRESENCE for env files but never echoes values.
 *   - Tolerates unknowns (null framework, null PM, missing env files)
 *     by emitting `?` rather than throwing.
 *   - Surfaces useful disambiguators (monorepo, app-router, etc.) from
 *     `frameworkContext` that the agent would otherwise probe for.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Integration } from '../../constants';
import { buildPreflightContext } from '../preflight-context';

import type { PackageManagerInfo } from '../../package-manager-detection-types';

function makeTmpInstallDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-ctx-'));
}

const PNPM_INFO: PackageManagerInfo = {
  detected: [
    {
      name: 'pnpm',
      label: 'pnpm',
      installCommand: 'pnpm add',
      runCommand: 'pnpm',
    },
  ],
  primary: {
    name: 'pnpm',
    label: 'pnpm',
    installCommand: 'pnpm add',
    runCommand: 'pnpm',
  },
  recommendation: 'Use pnpm (pnpm add).',
};

describe('buildPreflightContext', () => {
  let installDir: string;

  beforeEach(() => {
    installDir = makeTmpInstallDir();
  });

  afterEach(() => {
    try {
      fs.rmSync(installDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('renders the canonical header so the commandment can reference it', () => {
    const out = buildPreflightContext({
      installDir,
      integration: Integration.nextjs,
      detectedFrameworkLabel: 'Next.js 15.3',
      frameworkVersion: '15.3.0',
      typescript: true,
      packageManagerInfo: PNPM_INFO,
      userEmail: 'user@example.com',
      selectedOrgId: '21',
      selectedOrgName: 'Amplitude',
      selectedProjectId: '12345',
      selectedProjectName: 'test-delete-me',
      selectedEnvName: 'Production',
      cloudRegion: 'us',
      projectBound: true,
    });
    expect(out).toMatch(
      /^# Pre-flight context \(you have these answers; do NOT re-probe at start\)/,
    );
  });

  it('renders all three sections', () => {
    const out = buildPreflightContext({
      installDir,
      integration: Integration.nextjs,
      detectedFrameworkLabel: 'Next.js 15.3',
      frameworkVersion: '15.3.0',
      typescript: true,
      packageManagerInfo: PNPM_INFO,
      userEmail: 'user@example.com',
      selectedOrgId: '21',
      selectedOrgName: 'Amplitude',
      selectedProjectId: '12345',
      selectedProjectName: 'test-delete-me',
      selectedEnvName: 'Production',
      cloudRegion: 'us',
      projectBound: true,
    });
    expect(out).toContain('## Project');
    expect(out).toContain('## Amplitude state');
    expect(out).toContain('## Environment');
  });

  it('reminds the agent that discovery tools remain available later', () => {
    const out = buildPreflightContext({
      installDir,
      integration: Integration.generic,
      detectedFrameworkLabel: null,
      frameworkVersion: null,
      typescript: false,
      packageManagerInfo: null,
      userEmail: null,
      selectedOrgId: null,
      selectedOrgName: null,
      selectedProjectId: null,
      selectedProjectName: null,
      selectedEnvName: null,
      cloudRegion: 'us',
      projectBound: false,
    });
    expect(out).toMatch(/`detect_package_manager`/);
    expect(out).toMatch(/`check_env_keys`/);
    expect(out).toMatch(/remain available/);
  });

  it('surfaces the primary package manager + install command', () => {
    const out = buildPreflightContext({
      installDir,
      integration: Integration.nextjs,
      detectedFrameworkLabel: 'Next.js',
      frameworkVersion: 'latest',
      typescript: true,
      packageManagerInfo: PNPM_INFO,
      userEmail: null,
      selectedOrgId: null,
      selectedOrgName: null,
      selectedProjectId: null,
      selectedProjectName: null,
      selectedEnvName: null,
      cloudRegion: 'us',
      projectBound: false,
    });
    expect(out).toMatch(/package manager: pnpm \(install: pnpm add\)/);
  });

  it('emits a `?` placeholder when package manager detection is unavailable', () => {
    const out = buildPreflightContext({
      installDir,
      integration: Integration.generic,
      detectedFrameworkLabel: null,
      frameworkVersion: null,
      typescript: false,
      packageManagerInfo: null,
      userEmail: null,
      selectedOrgId: null,
      selectedOrgName: null,
      selectedProjectId: null,
      selectedProjectName: null,
      selectedEnvName: null,
      cloudRegion: 'us',
      projectBound: false,
    });
    expect(out).toMatch(/package manager: \?/);
  });

  it('lists multiple lockfiles when more than one is present', () => {
    const info: PackageManagerInfo = {
      detected: [
        {
          name: 'yarn',
          label: 'Yarn V1',
          installCommand: 'yarn add',
          runCommand: 'yarn',
        },
        {
          name: 'npm',
          label: 'npm',
          installCommand: 'npm add',
          runCommand: 'npm run',
        },
      ],
      primary: {
        name: 'yarn',
        label: 'Yarn V1',
        installCommand: 'yarn add',
        runCommand: 'yarn',
      },
      recommendation: 'Multiple package managers detected. Prefer Yarn V1.',
    };
    const out = buildPreflightContext({
      installDir,
      integration: Integration.javascript_web,
      detectedFrameworkLabel: 'Vite + React',
      frameworkVersion: 'latest',
      typescript: false,
      packageManagerInfo: info,
      userEmail: null,
      selectedOrgId: null,
      selectedOrgName: null,
      selectedProjectId: null,
      selectedProjectName: null,
      selectedEnvName: null,
      cloudRegion: 'us',
      projectBound: false,
    });
    expect(out).toMatch(/package manager: Yarn V1/);
    expect(out).toMatch(/other lockfiles present: npm/);
  });

  it('reports auth + org + project when known', () => {
    const out = buildPreflightContext({
      installDir,
      integration: Integration.nextjs,
      detectedFrameworkLabel: 'Next.js',
      frameworkVersion: 'latest',
      typescript: true,
      packageManagerInfo: PNPM_INFO,
      userEmail: 'kelson.warner@amplitude.com',
      selectedOrgId: '21',
      selectedOrgName: 'Amplitude',
      selectedProjectId: '12345',
      selectedProjectName: 'test-delete-me',
      selectedEnvName: 'Production',
      cloudRegion: 'eu',
      projectBound: true,
    });
    expect(out).toMatch(/auth: signed in \(kelson.warner@amplitude.com\)/);
    expect(out).toMatch(/org: Amplitude \(id: 21\)/);
    expect(out).toMatch(/project: test-delete-me \(id: 12345\)/);
    expect(out).toMatch(/region: eu/);
    expect(out).toMatch(/bound: yes/);
    expect(out).toMatch(/environment: Production/);
  });

  it('emits placeholders when org/project picker has not run yet', () => {
    const out = buildPreflightContext({
      installDir,
      integration: null,
      detectedFrameworkLabel: null,
      frameworkVersion: null,
      typescript: false,
      packageManagerInfo: null,
      userEmail: null,
      selectedOrgId: null,
      selectedOrgName: null,
      selectedProjectId: null,
      selectedProjectName: null,
      selectedEnvName: null,
      cloudRegion: 'us',
      projectBound: false,
    });
    expect(out).toMatch(/auth: \?/);
    expect(out).toMatch(/org: \?/);
    expect(out).toMatch(/project: \?/);
    expect(out).toMatch(/bound: no/);
  });

  it('reports env file presence and Amplitude key names without values', () => {
    fs.writeFileSync(
      path.join(installDir, '.env.local'),
      'AMPLITUDE_API_KEY=secret-do-not-leak\nFOO=bar\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(installDir, '.env.example'),
      'NEXT_PUBLIC_AMPLITUDE_API_KEY=\n',
      'utf8',
    );
    const out = buildPreflightContext({
      installDir,
      integration: Integration.nextjs,
      detectedFrameworkLabel: 'Next.js',
      frameworkVersion: 'latest',
      typescript: true,
      packageManagerInfo: PNPM_INFO,
      userEmail: null,
      selectedOrgId: null,
      selectedOrgName: null,
      selectedProjectId: null,
      selectedProjectName: null,
      selectedEnvName: null,
      cloudRegion: 'us',
      projectBound: false,
    });
    expect(out).toMatch(/env files present: .*\.env\.local/);
    expect(out).toMatch(/env files present: .*\.env\.example/);
    expect(out).toMatch(/AMPLITUDE_API_KEY: present in \.env\.local/);
    expect(out).toMatch(
      /NEXT_PUBLIC_AMPLITUDE_API_KEY: present in \.env\.example/,
    );
    // Crucially: secret values must never appear.
    expect(out).not.toContain('secret-do-not-leak');
    // And non-Amplitude keys are filtered out — we don't echo random app
    // secrets the user has in their .env.
    expect(out).not.toContain('FOO');
  });

  it('emits "none" markers when there are no env files', () => {
    const out = buildPreflightContext({
      installDir,
      integration: Integration.go,
      detectedFrameworkLabel: 'Go',
      frameworkVersion: 'latest',
      typescript: false,
      packageManagerInfo: null,
      userEmail: null,
      selectedOrgId: null,
      selectedOrgName: null,
      selectedProjectId: null,
      selectedProjectName: null,
      selectedEnvName: null,
      cloudRegion: 'us',
      projectBound: false,
    });
    expect(out).toMatch(/env files present: none/);
    expect(out).toMatch(/existing AMPLITUDE_\* keys: none/);
  });

  it('inlines framework-context disambiguators (e.g. monorepo, app router)', () => {
    const out = buildPreflightContext({
      installDir,
      integration: Integration.nextjs,
      detectedFrameworkLabel: 'Next.js 15.3',
      frameworkVersion: '15.3.0',
      typescript: true,
      packageManagerInfo: PNPM_INFO,
      userEmail: null,
      selectedOrgId: null,
      selectedOrgName: null,
      selectedProjectId: null,
      selectedProjectName: null,
      selectedEnvName: null,
      cloudRegion: 'us',
      projectBound: false,
      frameworkContext: {
        router: 'app',
        monorepo: true,
        workspace: 'apps/web',
      },
    });
    expect(out).toMatch(/framework context:/);
    expect(out).toMatch(/router: app/);
    expect(out).toMatch(/monorepo: true/);
    expect(out).toMatch(/workspace: apps\/web/);
  });

  it('parameterizes cleanly across (framework, monorepo, auth, env) cases', () => {
    type Case = {
      integration: Integration | null;
      monorepo: boolean;
      authed: boolean;
      hasEnvFiles: boolean;
    };
    const cases: Case[] = [
      {
        integration: Integration.nextjs,
        monorepo: false,
        authed: true,
        hasEnvFiles: true,
      },
      {
        integration: Integration.javascript_web,
        monorepo: true,
        authed: true,
        hasEnvFiles: false,
      },
      {
        integration: Integration.django,
        monorepo: false,
        authed: false,
        hasEnvFiles: false,
      },
      {
        integration: Integration.generic,
        monorepo: false,
        authed: false,
        hasEnvFiles: true,
      },
      {
        integration: null,
        monorepo: false,
        authed: false,
        hasEnvFiles: false,
      },
    ];
    for (const c of cases) {
      const dir = makeTmpInstallDir();
      try {
        if (c.hasEnvFiles) {
          fs.writeFileSync(
            path.join(dir, '.env'),
            'AMPLITUDE_API_KEY=stub\n',
            'utf8',
          );
        }
        const out = buildPreflightContext({
          installDir: dir,
          integration: c.integration,
          detectedFrameworkLabel: c.integration ? String(c.integration) : null,
          frameworkVersion: null,
          typescript: false,
          packageManagerInfo: c.integration ? PNPM_INFO : null,
          userEmail: c.authed ? 'u@example.com' : null,
          selectedOrgId: c.authed ? '1' : null,
          selectedOrgName: c.authed ? 'Acme' : null,
          selectedProjectId: c.authed ? '99' : null,
          selectedProjectName: c.authed ? 'web' : null,
          selectedEnvName: c.authed ? 'Production' : null,
          cloudRegion: 'us',
          projectBound: c.authed,
          frameworkContext: c.monorepo ? { monorepo: true } : undefined,
        });
        // Stable shape: every render contains all three section headers
        // and the discovery-tool reminder.
        expect(out).toContain('## Project');
        expect(out).toContain('## Amplitude state');
        expect(out).toContain('## Environment');
        expect(out).toMatch(/`detect_package_manager`/);
        // No env values ever leak.
        expect(out).not.toContain('stub');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});
