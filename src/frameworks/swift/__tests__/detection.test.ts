import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SWIFT_AGENT_CONFIG } from '../swift-wizard-agent.js';

describe('swift detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-detect-swift-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects Swift via *.xcodeproj directory', async () => {
    fs.mkdirSync(path.join(tmpDir, 'MyApp.xcodeproj'), { recursive: true });
    // place a placeholder file so the dir isn't pruned by any cleanup
    fs.writeFileSync(
      path.join(tmpDir, 'MyApp.xcodeproj', 'project.pbxproj'),
      '',
      'utf-8',
    );
    expect(
      await SWIFT_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('detects Swift via Podfile', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'Podfile'),
      "platform :ios, '15.0'\n",
      'utf-8',
    );
    expect(
      await SWIFT_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('detects Swift via Package.swift + .swift source', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'Package.swift'),
      '// swift-tools-version:5.9\nimport PackageDescription\n',
      'utf-8',
    );
    fs.mkdirSync(path.join(tmpDir, 'Sources', 'MyLib'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'Sources', 'MyLib', 'MyLib.swift'),
      'public struct MyLib {}\n',
      'utf-8',
    );
    expect(
      await SWIFT_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('returns false for an empty directory', async () => {
    expect(
      await SWIFT_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });

  it('returns false when Package.swift is present but no .swift sources', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'Package.swift'),
      '// swift-tools-version:5.9\n',
      'utf-8',
    );
    expect(
      await SWIFT_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });
});
