import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { VUE_AGENT_CONFIG } from '../vue-wizard-agent.js';

describe('vue detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-detect-vue-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects Vue when "vue" is in dependencies', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'my-vue-app',
        dependencies: { vue: '3.4.0' },
      }),
      'utf-8',
    );
    expect(
      await VUE_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('does not claim Nuxt projects (vue + nuxt)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'my-nuxt-app',
        dependencies: { vue: '3.4.0', nuxt: '3.0.0' },
      }),
      'utf-8',
    );
    expect(
      await VUE_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });

  it('returns false when package.json is missing', async () => {
    expect(
      await VUE_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });

  it('returns false when "vue" is not in deps', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'my-app',
        dependencies: { react: '18.0.0' },
      }),
      'utf-8',
    );
    expect(
      await VUE_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });
});
