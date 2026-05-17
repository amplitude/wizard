import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createTempDir } from '../../../utils/__tests__/helpers/temp-dir.js';
import {
  getDjangoProjectTypeName,
  getDjangoVersion,
  DjangoProjectType,
} from '../utils.js';

// ── getDjangoProjectTypeName ──────────────────────────────────────────────────

describe('getDjangoProjectTypeName', () => {
  it('returns "Standard Django" for STANDARD', () => {
    expect(getDjangoProjectTypeName(DjangoProjectType.STANDARD)).toBe(
      'Standard Django',
    );
  });

  it('returns "Django REST Framework" for DRF', () => {
    expect(getDjangoProjectTypeName(DjangoProjectType.DRF)).toBe(
      'Django REST Framework',
    );
  });

  it('returns "Wagtail CMS" for WAGTAIL', () => {
    expect(getDjangoProjectTypeName(DjangoProjectType.WAGTAIL)).toBe(
      'Wagtail CMS',
    );
  });

  it('returns "Django Channels" for CHANNELS', () => {
    expect(getDjangoProjectTypeName(DjangoProjectType.CHANNELS)).toBe(
      'Django Channels',
    );
  });
});

// ── getDjangoVersion ──────────────────────────────────────────────────────────

describe('getDjangoVersion', () => {
  let tmpDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ dir: tmpDir, cleanup } = createTempDir('django-utils-test-'));
  });

  afterEach(() => {
    cleanup();
  });

  it('extracts version from requirements.txt (==)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'requirements.txt'),
      'Django==4.2.0\n',
      'utf-8',
    );
    expect(await getDjangoVersion({ installDir: tmpDir })).toBe('4.2.0');
  });

  it('extracts version from requirements.txt (>=)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'requirements.txt'),
      'Django>=4.0\n',
      'utf-8',
    );
    expect(await getDjangoVersion({ installDir: tmpDir })).toBe('4.0');
  });

  it('extracts version from pyproject.toml format', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      '[project]\ndependencies = ["Django>=4.2"]\n',
      'utf-8',
    );
    expect(await getDjangoVersion({ installDir: tmpDir })).toBe('4.2');
  });

  it('returns undefined when no requirements file contains Django', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'requirements.txt'),
      'requests==2.28.0\n',
      'utf-8',
    );
    expect(await getDjangoVersion({ installDir: tmpDir })).toBeUndefined();
  });

  it('returns undefined when no requirements files exist', async () => {
    expect(await getDjangoVersion({ installDir: tmpDir })).toBeUndefined();
  });
});
