import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { JAVA_AGENT_CONFIG } from '../java-wizard-agent.js';

describe('java detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-detect-java-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects Java via pom.xml (Maven)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pom.xml'),
      '<project><modelVersion>4.0.0</modelVersion></project>\n',
      'utf-8',
    );
    expect(
      await JAVA_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('detects Java via build.gradle (Gradle)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'build.gradle'),
      'apply plugin: "java"\n',
      'utf-8',
    );
    expect(
      await JAVA_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('detects Java via build.gradle.kts (Kotlin DSL)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'build.gradle.kts'),
      'plugins { id("java") }\n',
      'utf-8',
    );
    expect(
      await JAVA_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('detects Java via src/main/java layout', async () => {
    fs.mkdirSync(path.join(tmpDir, 'src', 'main', 'java'), { recursive: true });
    expect(
      await JAVA_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('returns false for an empty directory', async () => {
    expect(
      await JAVA_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });
});
