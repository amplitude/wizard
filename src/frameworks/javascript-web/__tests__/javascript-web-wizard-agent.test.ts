import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { JAVASCRIPT_WEB_AGENT_CONFIG } from '../javascript-web-wizard-agent';

function makeOptions(installDir: string) {
  return {
    installDir,
    debug: false,
    forceInstall: false,
    default: false,
    signup: false,
    localMcp: false,
    ci: false,
    menu: false,
    benchmark: false,
  };
}

describe('JAVASCRIPT_WEB_AGENT_CONFIG.detection.detect', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsweb-detect-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('matches VitePress when vue is only there for the docs stack', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        devDependencies: {
          vue: '^3.5.0',
          vitepress: '^1.6.0',
          vite: '^6.0.0',
        },
      }),
    );
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');

    const detected = await JAVASCRIPT_WEB_AGENT_CONFIG.detection.detect(
      makeOptions(tmpDir),
    );
    expect(detected).toBe(true);
  });

  it('matches Slidev when vue is only there for the deck stack', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        devDependencies: {
          vue: '^3.5.0',
          slidev: '^52.0.0',
          vite: '^6.0.0',
        },
      }),
    );
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '');

    const detected = await JAVASCRIPT_WEB_AGENT_CONFIG.detection.detect(
      makeOptions(tmpDir),
    );
    expect(detected).toBe(true);
  });
});
