import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { REACT_NATIVE_AGENT_CONFIG } from '../react-native-wizard-agent.js';

describe('react-native detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'wizard-detect-react-native-'),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects RN when "react-native" is in dependencies', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'my-rn-app',
        dependencies: { 'react-native': '0.73.0', react: '18.2.0' },
      }),
      'utf-8',
    );
    expect(
      await REACT_NATIVE_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('detects RN when in devDependencies', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'my-rn-app',
        devDependencies: { 'react-native': '0.73.0' },
      }),
      'utf-8',
    );
    expect(
      await REACT_NATIVE_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('returns false when only react is present (no react-native)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'my-web-app',
        dependencies: { react: '18.0.0' },
      }),
      'utf-8',
    );
    expect(
      await REACT_NATIVE_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });

  it('returns false when package.json is missing', async () => {
    expect(
      await REACT_NATIVE_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });
});
