import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { loadCheckpoint } from '../session-checkpoint';
import { Integration } from '../constants';

function checkpointPathFor(installDir: string): string {
  const hash = createHash('sha256')
    .update(installDir)
    .digest('hex')
    .slice(0, 12);
  return path.join(os.tmpdir(), `amplitude-wizard-checkpoint-${hash}.json`);
}

function writeCheckpoint(
  installDir: string,
  overrides: Record<string, unknown> = {},
): string {
  const filePath = checkpointPathFor(installDir);
  const payload = {
    savedAt: new Date().toISOString(),
    installDir,
    region: 'us',
    selectedOrgId: 'org-1',
    selectedOrgName: 'Acme',
    selectedWorkspaceId: null,
    selectedWorkspaceName: null,
    selectedEnvName: null,
    integration: null,
    detectedFrameworkLabel: null,
    detectionComplete: false,
    frameworkContext: {},
    introConcluded: false,
    ...overrides,
  };
  fs.writeFileSync(filePath, JSON.stringify(payload));
  return filePath;
}

describe('loadCheckpoint — self-healing of detectedFrameworkLabel', () => {
  let installDir: string;
  let filePath: string;

  beforeEach(() => {
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-ckpt-'));
  });

  afterEach(() => {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    fs.rmSync(installDir, { recursive: true, force: true });
  });

  it('overrides a stale "Generic" label when integration is a known framework', () => {
    filePath = writeCheckpoint(installDir, {
      integration: Integration.javascript_web,
      detectedFrameworkLabel: 'Generic', // stale — older buggy runs wrote this
    });

    const loaded = loadCheckpoint(installDir);
    expect(loaded?.integration).toBe(Integration.javascript_web);
    expect(loaded?.detectedFrameworkLabel).toBe('JavaScript (Web)');
  });

  it('derives the label for Vue when integration is set', () => {
    filePath = writeCheckpoint(installDir, {
      integration: Integration.vue,
      detectedFrameworkLabel: null,
    });

    const loaded = loadCheckpoint(installDir);
    expect(loaded?.detectedFrameworkLabel).toBe('Vue');
  });

  it('keeps the persisted label when integration is null', () => {
    filePath = writeCheckpoint(installDir, {
      integration: null,
      detectedFrameworkLabel: 'Custom',
    });

    const loaded = loadCheckpoint(installDir);
    expect(loaded?.detectedFrameworkLabel).toBe('Custom');
  });

  it('keeps the persisted label when integration is unknown', () => {
    filePath = writeCheckpoint(installDir, {
      integration: 'made-up-framework',
      detectedFrameworkLabel: 'Made Up',
    });

    const loaded = loadCheckpoint(installDir);
    expect(loaded?.detectedFrameworkLabel).toBe('Made Up');
  });
});
