import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DJANGO_AGENT_CONFIG } from '../django-wizard-agent.js';

describe('django detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-detect-django-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects Django via manage.py with Django imports + settings.py', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'manage.py'),
      '#!/usr/bin/env python\nimport os\nimport sys\nfrom django.core.management import execute_from_command_line\nos.environ.setdefault("DJANGO_SETTINGS_MODULE", "myapp.settings")\n',
      'utf-8',
    );
    fs.mkdirSync(path.join(tmpDir, 'myapp'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'myapp', 'settings.py'),
      'ROOT_URLCONF = "myapp.urls"\n',
      'utf-8',
    );

    expect(
      await DJANGO_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('detects Django via requirements.txt', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'requirements.txt'),
      'Django==4.2.0\n',
      'utf-8',
    );
    expect(
      await DJANGO_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('returns false when no Django markers present', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'requirements.txt'),
      'requests==2.28.0\nflask==2.3.0\n',
      'utf-8',
    );
    expect(
      await DJANGO_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });

  it('returns false for an empty directory', async () => {
    expect(
      await DJANGO_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });
});
