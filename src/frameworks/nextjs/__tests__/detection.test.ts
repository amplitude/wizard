import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { NEXTJS_AGENT_CONFIG } from '../nextjs-wizard-agent.js';

describe('nextjs detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-detect-nextjs-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects Next.js when "next" is in dependencies', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'my-app',
        dependencies: { next: '15.0.0', react: '18.0.0' },
      }),
      'utf-8',
    );
    expect(
      await NEXTJS_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('detects Next.js when "next" is in devDependencies', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'my-app',
        devDependencies: { next: '15.0.0' },
      }),
      'utf-8',
    );
    expect(
      await NEXTJS_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('returns false when package.json is missing', async () => {
    expect(
      await NEXTJS_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });

  it('returns false when "next" is not in dependencies', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'my-app',
        dependencies: { react: '18.0.0' },
      }),
      'utf-8',
    );
    expect(
      await NEXTJS_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });
});
