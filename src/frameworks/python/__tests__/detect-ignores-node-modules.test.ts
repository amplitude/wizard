/**
 * Regression test: python-family detectors must skip `node_modules`.
 *
 * Background: the inline `detect()` functions in {django,flask,fastapi,
 * python}-wizard-agent.ts used to pass a stripped-down ignore list that
 * dropped `**\/node_modules/**`. On a Node.js project, scanning for
 * `**\/pyproject.toml` walks every transitive dep — turning a sub-100ms
 * detection into 6+ seconds. This test pins the fix so a future refactor
 * can't silently re-introduce the regression.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { DJANGO_AGENT_CONFIG } from '../../django/django-wizard-agent.js';
import { FLASK_AGENT_CONFIG } from '../../flask/flask-wizard-agent.js';
import { FASTAPI_AGENT_CONFIG } from '../../fastapi/fastapi-wizard-agent.js';
import { PYTHON_AGENT_CONFIG } from '../python-wizard-agent.js';

const baseOptions = {
  debug: false,
  forceInstall: false,
  default: false,
  signup: false,
  localMcp: false,
  ci: false,
  menu: false,
  benchmark: false,
};

describe('python-family detect() ignores node_modules', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-ignore-'));

    // Top-level: a Node project with NO Python signal. package.json only.
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'fake', version: '0.0.0' }),
    );

    // Buried Python signals inside node_modules — these must be ignored.
    const nestedDjango = path.join(
      tmpDir,
      'node_modules',
      'some-pkg',
      'fixtures',
    );
    fs.mkdirSync(nestedDjango, { recursive: true });
    fs.writeFileSync(
      path.join(nestedDjango, 'manage.py'),
      '#!/usr/bin/env python\nimport django\nDJANGO_SETTINGS_MODULE = "x"\n',
    );
    fs.writeFileSync(
      path.join(nestedDjango, 'requirements.txt'),
      'django>=4\nflask\nfastapi\n',
    );
    fs.writeFileSync(
      path.join(nestedDjango, 'pyproject.toml'),
      '[tool.poetry.dependencies]\ndjango = "^4"\nflask = "^2"\nfastapi = "^0.1"\n',
    );

    // Also bury .py files matching the source-scan globs.
    fs.writeFileSync(
      path.join(nestedDjango, 'app.py'),
      'from flask import Flask\napp = Flask(__name__)\n',
    );
    fs.writeFileSync(
      path.join(nestedDjango, 'main.py'),
      'from fastapi import FastAPI\napp = FastAPI()\n',
    );
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('django: no false positive from node_modules', async () => {
    const detected = await DJANGO_AGENT_CONFIG.detection.detect({
      ...baseOptions,
      installDir: tmpDir,
    });
    expect(detected).toBe(false);
  });

  it('flask: no false positive from node_modules', async () => {
    const detected = await FLASK_AGENT_CONFIG.detection.detect({
      ...baseOptions,
      installDir: tmpDir,
    });
    expect(detected).toBe(false);
  });

  it('fastapi: no false positive from node_modules', async () => {
    const detected = await FASTAPI_AGENT_CONFIG.detection.detect({
      ...baseOptions,
      installDir: tmpDir,
    });
    expect(detected).toBe(false);
  });

  it('python: no false positive from node_modules', async () => {
    const detected = await PYTHON_AGENT_CONFIG.detection.detect({
      ...baseOptions,
      installDir: tmpDir,
    });
    expect(detected).toBe(false);
  });

  it('detection completes well under the old 6s+ regression', async () => {
    const start = performance.now();
    await Promise.all([
      DJANGO_AGENT_CONFIG.detection.detect({
        ...baseOptions,
        installDir: tmpDir,
      }),
      FLASK_AGENT_CONFIG.detection.detect({
        ...baseOptions,
        installDir: tmpDir,
      }),
      FASTAPI_AGENT_CONFIG.detection.detect({
        ...baseOptions,
        installDir: tmpDir,
      }),
      PYTHON_AGENT_CONFIG.detection.detect({
        ...baseOptions,
        installDir: tmpDir,
      }),
    ]);
    const durationMs = performance.now() - start;
    // Generous bound — pre-fix this would have been multi-second on a
    // populated node_modules. Empty node_modules here is fast either way,
    // but the assertion documents the intent.
    expect(durationMs).toBeLessThan(2000);
  });
});
