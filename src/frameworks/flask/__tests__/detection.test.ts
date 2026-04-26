import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FLASK_AGENT_CONFIG } from '../flask-wizard-agent.js';

describe('flask detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-detect-flask-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects Flask via app.py with "from flask import Flask"', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'app.py'),
      'from flask import Flask\napp = Flask(__name__)\n',
      'utf-8',
    );
    expect(
      await FLASK_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('detects Flask via requirements.txt', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'requirements.txt'),
      'Flask==2.3.0\n',
      'utf-8',
    );
    expect(
      await FLASK_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('returns false when no Flask markers', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'requirements.txt'),
      'requests==2.28.0\n',
      'utf-8',
    );
    fs.writeFileSync(path.join(tmpDir, 'app.py'), 'print("hello")\n', 'utf-8');
    expect(
      await FLASK_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });

  it('returns false for an empty directory', async () => {
    expect(
      await FLASK_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });
});
