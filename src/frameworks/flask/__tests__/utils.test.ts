import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getFlaskProjectTypeName,
  getFlaskVersion,
  FlaskProjectType,
} from '../utils.js';

// ── getFlaskProjectTypeName ───────────────────────────────────────────────────

describe('getFlaskProjectTypeName', () => {
  it('returns "Standard Flask" for STANDARD', () => {
    expect(getFlaskProjectTypeName(FlaskProjectType.STANDARD)).toBe(
      'Standard Flask',
    );
  });

  it('returns "Flask-RESTful" for RESTFUL', () => {
    expect(getFlaskProjectTypeName(FlaskProjectType.RESTFUL)).toBe(
      'Flask-RESTful',
    );
  });

  it('returns "Flask-RESTX" for RESTX', () => {
    expect(getFlaskProjectTypeName(FlaskProjectType.RESTX)).toBe('Flask-RESTX');
  });

  it('returns "flask-smorest" for SMOREST', () => {
    expect(getFlaskProjectTypeName(FlaskProjectType.SMOREST)).toBe(
      'flask-smorest',
    );
  });

  it('returns "Flask with Blueprints" for BLUEPRINT', () => {
    expect(getFlaskProjectTypeName(FlaskProjectType.BLUEPRINT)).toBe(
      'Flask with Blueprints',
    );
  });
});

// ── getFlaskVersion ───────────────────────────────────────────────────────────

describe('getFlaskVersion', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flask-utils-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts version from requirements.txt (==)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'requirements.txt'),
      'Flask==3.0.0\n',
      'utf-8',
    );
    expect(await getFlaskVersion({ installDir: tmpDir })).toBe('3.0.0');
  });

  it('extracts version case-insensitively (flask==)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'requirements.txt'),
      'flask>=2.3.0\n',
      'utf-8',
    );
    expect(await getFlaskVersion({ installDir: tmpDir })).toBe('2.3.0');
  });

  it('extracts version from pyproject.toml', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      '[project]\ndependencies = ["Flask>=3.0"]\n',
      'utf-8',
    );
    expect(await getFlaskVersion({ installDir: tmpDir })).toBe('3.0');
  });

  it('returns undefined when no requirements file mentions Flask', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'requirements.txt'),
      'requests==2.28.0\n',
      'utf-8',
    );
    expect(await getFlaskVersion({ installDir: tmpDir })).toBeUndefined();
  });

  it('returns undefined when no requirements files exist', async () => {
    expect(await getFlaskVersion({ installDir: tmpDir })).toBeUndefined();
  });
});
