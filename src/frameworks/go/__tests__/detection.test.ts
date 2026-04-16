import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { GO_AGENT_CONFIG } from '../go-wizard-agent.js';

describe('go detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-detect-go-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects Go via go.mod at root', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'go.mod'),
      'module example.com/my-app\n\ngo 1.21\n',
      'utf-8',
    );
    expect(await GO_AGENT_CONFIG.detection.detect({ installDir: tmpDir })).toBe(
      true,
    );
  });

  it('returns false when go.mod is missing', async () => {
    expect(await GO_AGENT_CONFIG.detection.detect({ installDir: tmpDir })).toBe(
      false,
    );
  });

  it('returns false when only a go.sum exists without go.mod', async () => {
    fs.writeFileSync(path.join(tmpDir, 'go.sum'), '', 'utf-8');
    expect(await GO_AGENT_CONFIG.detection.detect({ installDir: tmpDir })).toBe(
      false,
    );
  });
});
