import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PYTHON_AGENT_CONFIG } from '../python-wizard-agent.js';

describe('python fallback detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-detect-python-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects generic Python project with requirements.txt', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'requirements.txt'),
      'requests==2.28.0\nclick==8.1.0\n',
      'utf-8',
    );
    expect(
      await PYTHON_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('detects generic Python project via pyproject.toml', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      '[project]\nname = "my-cli"\n',
      'utf-8',
    );
    expect(
      await PYTHON_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('returns false when Flask is present (Flask agent should handle it)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'requirements.txt'),
      'Flask==2.3.0\n',
      'utf-8',
    );
    expect(
      await PYTHON_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });

  it('returns false when Django manage.py is present', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'requirements.txt'),
      'Django==4.2.0\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'manage.py'),
      'import django\nDJANGO_SETTINGS_MODULE = "myapp.settings"\n',
      'utf-8',
    );
    expect(
      await PYTHON_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });

  it('returns false for an empty directory', async () => {
    expect(
      await PYTHON_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });
});
