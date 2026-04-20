import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FASTAPI_AGENT_CONFIG } from '../fastapi-wizard-agent.js';

describe('fastapi detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-detect-fastapi-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects FastAPI via main.py with "from fastapi import FastAPI"', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'main.py'),
      'from fastapi import FastAPI\napp = FastAPI()\n',
      'utf-8',
    );
    expect(
      await FASTAPI_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('detects FastAPI via requirements.txt', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'requirements.txt'),
      'fastapi==0.110.0\nuvicorn==0.27.0\n',
      'utf-8',
    );
    expect(
      await FASTAPI_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('returns false when no FastAPI markers', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'requirements.txt'),
      'requests==2.28.0\n',
      'utf-8',
    );
    fs.writeFileSync(path.join(tmpDir, 'main.py'), 'print("hello")\n', 'utf-8');
    expect(
      await FASTAPI_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });

  it('returns false for an empty directory', async () => {
    expect(
      await FASTAPI_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });
});
