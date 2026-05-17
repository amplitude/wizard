/**
 * Golden snapshots for `buildPreflightContext`. These pin the exact
 * rendered Markdown byte-for-byte so any refactor of the renderer
 * (e.g. extracting a shared Markdown-builder helper) cannot silently
 * change the system-prompt the agent receives.
 *
 * The preflight block is load-bearing: the wizard commandments reference
 * its canonical header and the cold-start probe-skip behavior depends on
 * the agent reading the exact section names. PR #828 deferred broader
 * dedup work as "system-prompt-load-bearing" — these snapshots are the
 * safety net that lets that work proceed.
 *
 * Coverage chosen to exercise every render path:
 *   1. Full happy path — Next.js, signed-in, bound, all fields known
 *   2. Minimal unknowns — null framework, null pm, no env files
 *   3. Multiple lockfiles — yarn primary with npm sibling
 *   4. Framework context disambiguators — monorepo / workspace
 *   5. Env-file scan with Amplitude keys present
 *   6. EU region with id-only org/project (no display names)
 *   7. JIT mode — large project, environment block suppressed
 *
 * If a snapshot changes, ASK whether the change is intentional. A passing
 * but updated snapshot is the same as a silent system-prompt regression.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Integration } from '../../constants';
import { buildPreflightContext } from '../preflight-context';

import type { PackageManagerInfo } from '../../package-manager-detection-types';

function makeTmpInstallDir(prefix = 'preflight-golden-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

const YARN_NPM_INFO: PackageManagerInfo = {
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

/**
 * Replace any occurrence of the tmpdir-derived install path with a stable
 * placeholder so the snapshot doesn't depend on the runner's $TMPDIR.
 */
function stabilizeInstallDir(out: string, installDir: string): string {
  return out.split(installDir).join('<INSTALL_DIR>');
}

describe('buildPreflightContext — golden snapshots', () => {
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

  it('snapshot: full happy path (Next.js, signed in, bound, US)', async () => {
    const { prompt } = await buildPreflightContext({
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
      // Pin small-project mode so the env-scan section is included.
      projectSize: {
        fileCount: 10,
        eventCount: 0,
        timedOut: false,
        capHit: false,
      },
    });
    expect(stabilizeInstallDir(prompt, installDir)).toMatchSnapshot();
  });

  it('snapshot: minimal — null framework, null pm, no env files', async () => {
    const { prompt } = await buildPreflightContext({
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
      projectSize: {
        fileCount: 5,
        eventCount: 0,
        timedOut: false,
        capHit: false,
      },
    });
    expect(stabilizeInstallDir(prompt, installDir)).toMatchSnapshot();
  });

  it('snapshot: multiple lockfiles (yarn primary + npm sibling)', async () => {
    const { prompt } = await buildPreflightContext({
      installDir,
      integration: Integration.javascript_web,
      detectedFrameworkLabel: 'Vite + React',
      frameworkVersion: 'latest',
      typescript: false,
      packageManagerInfo: YARN_NPM_INFO,
      userEmail: null,
      selectedOrgId: null,
      selectedOrgName: null,
      selectedProjectId: null,
      selectedProjectName: null,
      selectedEnvName: null,
      cloudRegion: 'us',
      projectBound: false,
      projectSize: {
        fileCount: 10,
        eventCount: 0,
        timedOut: false,
        capHit: false,
      },
    });
    expect(stabilizeInstallDir(prompt, installDir)).toMatchSnapshot();
  });

  it('snapshot: framework context with monorepo / workspace disambiguators', async () => {
    const { prompt } = await buildPreflightContext({
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
      projectSize: {
        fileCount: 10,
        eventCount: 0,
        timedOut: false,
        capHit: false,
      },
    });
    expect(stabilizeInstallDir(prompt, installDir)).toMatchSnapshot();
  });

  it('snapshot: env-file scan with Amplitude keys present in multiple files', async () => {
    fs.writeFileSync(
      path.join(installDir, '.env.local'),
      'AMPLITUDE_API_KEY=secret-do-not-leak\nFOO=bar\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(installDir, '.env.example'),
      'NEXT_PUBLIC_AMPLITUDE_API_KEY=\nAMPLITUDE_API_KEY=\n',
      'utf8',
    );
    const { prompt } = await buildPreflightContext({
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
      projectSize: {
        fileCount: 10,
        eventCount: 0,
        timedOut: false,
        capHit: false,
      },
    });
    expect(stabilizeInstallDir(prompt, installDir)).toMatchSnapshot();
  });

  it('snapshot: EU region with id-only org/project (no display names)', async () => {
    const { prompt } = await buildPreflightContext({
      installDir,
      integration: Integration.django,
      detectedFrameworkLabel: 'Django',
      frameworkVersion: '5.0',
      typescript: false,
      packageManagerInfo: null,
      userEmail: 'kelson.warner@amplitude.com',
      selectedOrgId: '21',
      selectedOrgName: null,
      selectedProjectId: '99',
      selectedProjectName: null,
      selectedEnvName: null,
      cloudRegion: 'eu',
      projectBound: true,
      projectSize: {
        fileCount: 10,
        eventCount: 0,
        timedOut: false,
        capHit: false,
      },
    });
    expect(stabilizeInstallDir(prompt, installDir)).toMatchSnapshot();
  });

  it('snapshot: JIT mode — large project, environment block suppressed', async () => {
    const { prompt } = await buildPreflightContext({
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
      projectSize: {
        fileCount: 5_000,
        eventCount: 0,
        timedOut: false,
        capHit: false,
      },
    });
    expect(stabilizeInstallDir(prompt, installDir)).toMatchSnapshot();
  });
});
