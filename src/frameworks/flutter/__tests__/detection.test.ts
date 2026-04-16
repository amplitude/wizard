import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FLUTTER_AGENT_CONFIG } from '../flutter-wizard-agent.js';

describe('flutter detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-detect-flutter-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects Flutter via pubspec.yaml with flutter SDK ref', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pubspec.yaml'),
      'name: my_app\ndependencies:\n  flutter:\n    sdk: flutter\n',
      'utf-8',
    );
    expect(
      await FLUTTER_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('detects Flutter via android/ + ios/ sibling dirs', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pubspec.yaml'),
      'name: my_app\n',
      'utf-8',
    );
    fs.mkdirSync(path.join(tmpDir, 'android'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'ios'), { recursive: true });
    expect(
      await FLUTTER_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('returns false when pubspec.yaml is missing', async () => {
    expect(
      await FLUTTER_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });

  it('returns false for pubspec.yaml without flutter marker and no platform dirs', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pubspec.yaml'),
      'name: my_dart_pkg\nversion: 1.0.0\n',
      'utf-8',
    );
    expect(
      await FLUTTER_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });
});
