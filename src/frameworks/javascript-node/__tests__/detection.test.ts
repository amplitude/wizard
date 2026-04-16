import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { JAVASCRIPT_NODE_AGENT_CONFIG } from '../javascript-node-wizard-agent.js';

describe('javascript-node detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-detect-js-node-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects Node project with express (no framework packages)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'my-api',
        dependencies: { express: '4.18.0' },
      }),
      'utf-8',
    );
    expect(
      await JAVASCRIPT_NODE_AGENT_CONFIG.detection.detect({
        installDir: tmpDir,
      }),
    ).toBe(true);
  });

  it('detects Node project with koa', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'my-koa-api',
        dependencies: { koa: '2.14.0' },
      }),
      'utf-8',
    );
    expect(
      await JAVASCRIPT_NODE_AGENT_CONFIG.detection.detect({
        installDir: tmpDir,
      }),
    ).toBe(true);
  });

  it('returns false when "next" is in deps (framework project)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'nextjs-app',
        dependencies: { next: '15.0.0' },
      }),
      'utf-8',
    );
    expect(
      await JAVASCRIPT_NODE_AGENT_CONFIG.detection.detect({
        installDir: tmpDir,
      }),
    ).toBe(false);
  });

  it('returns false when "react-native" is in deps', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'rn-app',
        dependencies: { 'react-native': '0.73.0' },
      }),
      'utf-8',
    );
    expect(
      await JAVASCRIPT_NODE_AGENT_CONFIG.detection.detect({
        installDir: tmpDir,
      }),
    ).toBe(false);
  });

  it('returns false when package.json is missing', async () => {
    expect(
      await JAVASCRIPT_NODE_AGENT_CONFIG.detection.detect({
        installDir: tmpDir,
      }),
    ).toBe(false);
  });
});
