import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ANDROID_AGENT_CONFIG } from '../android-wizard-agent.js';

describe('android detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-detect-android-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects Android via app/src/main/AndroidManifest.xml', async () => {
    fs.mkdirSync(path.join(tmpDir, 'app', 'src', 'main'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'app', 'src', 'main', 'AndroidManifest.xml'),
      '<manifest package="com.example.app"/>\n',
      'utf-8',
    );
    expect(
      await ANDROID_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('returns false for an empty directory', async () => {
    expect(
      await ANDROID_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });

  it('returns false when only build.gradle exists (no AndroidManifest.xml)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'build.gradle'),
      'apply plugin: "java"\n',
      'utf-8',
    );
    expect(
      await ANDROID_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });
});
