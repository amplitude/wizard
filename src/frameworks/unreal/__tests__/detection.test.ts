import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { UNREAL_AGENT_CONFIG } from '../unreal-wizard-agent.js';

describe('unreal detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-detect-unreal-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects Unreal via *.uproject at root', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'MyGame.uproject'),
      JSON.stringify({ FileVersion: 3, EngineAssociation: '5.3' }),
      'utf-8',
    );
    expect(
      await UNREAL_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('returns false for an empty directory', async () => {
    expect(
      await UNREAL_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });

  it('returns false when only a .uplugin file is present (no .uproject)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'MyPlugin.uplugin'), '{}', 'utf-8');
    expect(
      await UNREAL_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });
});
