import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { JAVASCRIPT_WEB_AGENT_CONFIG } from '../javascript-web-wizard-agent.js';

describe('javascript-web detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-detect-js-web-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects when index.html and lockfile exist without framework deps', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'my-app',
        dependencies: {},
      }),
      'utf-8',
    );
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}', 'utf-8');
    fs.writeFileSync(
      path.join(tmpDir, 'index.html'),
      '<!DOCTYPE html><html></html>',
      'utf-8',
    );

    expect(
      await JAVASCRIPT_WEB_AGENT_CONFIG.detection.detect({
        installDir: tmpDir,
      }),
    ).toBe(true);
  });

  it('detects when lockfile and bundler (vite) present without framework deps', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'my-app',
        devDependencies: { vite: '5.0.0' },
      }),
      'utf-8',
    );
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}', 'utf-8');

    expect(
      await JAVASCRIPT_WEB_AGENT_CONFIG.detection.detect({
        installDir: tmpDir,
      }),
    ).toBe(true);
  });

  it('returns false when "next" is in deps (framework project)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'my-app',
        dependencies: { next: '15.0.0' },
      }),
      'utf-8',
    );
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, 'index.html'), '', 'utf-8');

    expect(
      await JAVASCRIPT_WEB_AGENT_CONFIG.detection.detect({
        installDir: tmpDir,
      }),
    ).toBe(false);
  });

  it('returns false when package.json has a "bin" field (Node CLI)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'my-cli',
        bin: { mycli: './bin.js' },
      }),
      'utf-8',
    );
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, 'index.html'), '', 'utf-8');

    expect(
      await JAVASCRIPT_WEB_AGENT_CONFIG.detection.detect({
        installDir: tmpDir,
      }),
    ).toBe(false);
  });

  it('returns false when no lockfile present', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'my-app' }),
      'utf-8',
    );
    fs.writeFileSync(path.join(tmpDir, 'index.html'), '', 'utf-8');

    expect(
      await JAVASCRIPT_WEB_AGENT_CONFIG.detection.detect({
        installDir: tmpDir,
      }),
    ).toBe(false);
  });

  it('returns false when package.json is missing', async () => {
    expect(
      await JAVASCRIPT_WEB_AGENT_CONFIG.detection.detect({
        installDir: tmpDir,
      }),
    ).toBe(false);
  });
});
