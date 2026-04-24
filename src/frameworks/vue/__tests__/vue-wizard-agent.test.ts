import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { VUE_AGENT_CONFIG } from '../vue-wizard-agent';

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

describe('VUE_AGENT_CONFIG.detection.detect', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vue-detect-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects Vue via package.json when vue is a dependency', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { vue: '^3.5.0' } }),
    );

    const detected = await VUE_AGENT_CONFIG.detection.detect(
      makeOptions(tmpDir),
    );
    expect(detected).toBe(true);
  });

  it('ignores Nuxt projects even when vue is present', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        dependencies: { vue: '^3.5.0', nuxt: '^3.0.0' },
      }),
    );

    const detected = await VUE_AGENT_CONFIG.detection.detect(
      makeOptions(tmpDir),
    );
    expect(detected).toBe(false);
  });

  it('falls back to .vue file sniff when package.json is missing', async () => {
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'App.vue'),
      '<template><div>hi</div></template>',
    );

    const detected = await VUE_AGENT_CONFIG.detection.detect(
      makeOptions(tmpDir),
    );
    expect(detected).toBe(true);
  });

  it('falls back to .vue file sniff when package.json lacks vue', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'mystery-app' }),
    );
    fs.writeFileSync(
      path.join(tmpDir, 'Component.vue'),
      '<template><span /></template>',
    );

    const detected = await VUE_AGENT_CONFIG.detection.detect(
      makeOptions(tmpDir),
    );
    expect(detected).toBe(true);
  });

  it('refuses the file fallback when a nuxt.config is present', async () => {
    fs.writeFileSync(path.join(tmpDir, 'nuxt.config.ts'), 'export default {}');
    fs.writeFileSync(path.join(tmpDir, 'App.vue'), '<template></template>');

    const detected = await VUE_AGENT_CONFIG.detection.detect(
      makeOptions(tmpDir),
    );
    expect(detected).toBe(false);
  });

  it('ignores .vue files inside node_modules / dist', async () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'vendor'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpDir, 'node_modules', 'vendor', 'Thing.vue'),
      '<template></template>',
    );
    fs.mkdirSync(path.join(tmpDir, 'dist'));
    fs.writeFileSync(
      path.join(tmpDir, 'dist', 'built.vue'),
      '<template></template>',
    );

    const detected = await VUE_AGENT_CONFIG.detection.detect(
      makeOptions(tmpDir),
    );
    expect(detected).toBe(false);
  });

  it('returns false for an empty directory', async () => {
    const detected = await VUE_AGENT_CONFIG.detection.detect(
      makeOptions(tmpDir),
    );
    expect(detected).toBe(false);
  });
});
