import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { UNITY_AGENT_CONFIG } from '../unity-wizard-agent.js';

describe('unity detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-detect-unity-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects Unity via ProjectSettings/ProjectVersion.txt', async () => {
    fs.mkdirSync(path.join(tmpDir, 'ProjectSettings'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'ProjectSettings', 'ProjectVersion.txt'),
      'm_EditorVersion: 2022.3.0f1\n',
      'utf-8',
    );
    expect(
      await UNITY_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('returns false for an empty directory', async () => {
    expect(
      await UNITY_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });

  it('returns false when ProjectSettings exists but ProjectVersion.txt is missing', async () => {
    fs.mkdirSync(path.join(tmpDir, 'ProjectSettings'), { recursive: true });
    expect(
      await UNITY_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });
});
