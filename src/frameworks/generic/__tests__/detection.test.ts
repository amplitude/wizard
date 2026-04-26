import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { GENERIC_AGENT_CONFIG } from '../generic-wizard-agent.js';

describe('generic fallback detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-detect-generic-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // The Generic agent is the ultimate fallback: it is selected by the registry
  // only when nothing else matches, so its own detect() always returns false.

  it('always returns false for an empty directory (ultimate fallback)', async () => {
    expect(
      await GENERIC_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });

  it('always returns false even when project files are present', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# My project\n', 'utf-8');
    fs.writeFileSync(
      path.join(tmpDir, 'index.html'),
      '<!DOCTYPE html>',
      'utf-8',
    );
    expect(
      await GENERIC_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });
});
