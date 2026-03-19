import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getPythonVersionBucket,
  getPackageManagerName,
  detectPackageManager,
  PythonPackageManager,
} from '../utils.js';

// ── getPythonVersionBucket ────────────────────────────────────────────────────

describe('getPythonVersionBucket', () => {
  it('returns "3.11" for "3.11.5"', () => {
    expect(getPythonVersionBucket('3.11.5')).toBe('3.11');
  });

  it('returns "3.10" for "3.10.0"', () => {
    expect(getPythonVersionBucket('3.10.0')).toBe('3.10');
  });

  it('returns the input unchanged for unexpected format', () => {
    expect(getPythonVersionBucket('unknown')).toBe('unknown');
  });

  it('returns "3.9" for "3.9"', () => {
    expect(getPythonVersionBucket('3.9')).toBe('3.9');
  });
});

// ── getPackageManagerName ─────────────────────────────────────────────────────

describe('getPackageManagerName', () => {
  it('returns "uv" for UV', () => {
    expect(getPackageManagerName(PythonPackageManager.UV)).toBe('uv');
  });

  it('returns "Poetry" for POETRY', () => {
    expect(getPackageManagerName(PythonPackageManager.POETRY)).toBe('Poetry');
  });

  it('returns "PDM" for PDM', () => {
    expect(getPackageManagerName(PythonPackageManager.PDM)).toBe('PDM');
  });

  it('returns "Hatch" for HATCH', () => {
    expect(getPackageManagerName(PythonPackageManager.HATCH)).toBe('Hatch');
  });

  it('returns "Rye" for RYE', () => {
    expect(getPackageManagerName(PythonPackageManager.RYE)).toBe('Rye');
  });

  it('returns "Pipenv" for PIPENV', () => {
    expect(getPackageManagerName(PythonPackageManager.PIPENV)).toBe('Pipenv');
  });

  it('returns "Conda" for CONDA', () => {
    expect(getPackageManagerName(PythonPackageManager.CONDA)).toBe('Conda');
  });

  it('returns "pip" for PIP', () => {
    expect(getPackageManagerName(PythonPackageManager.PIP)).toBe('pip');
  });

  it('returns "unknown" for UNKNOWN', () => {
    expect(getPackageManagerName(PythonPackageManager.UNKNOWN)).toBe('unknown');
  });
});

// ── detectPackageManager ──────────────────────────────────────────────────────

describe('detectPackageManager', () => {
  let tmpDir: string;

  const options = (installDir: string) => ({ installDir } as any);

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'python-utils-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects uv via uv.lock', async () => {
    fs.writeFileSync(path.join(tmpDir, 'uv.lock'), '', 'utf-8');
    expect(await detectPackageManager(options(tmpDir))).toBe(
      PythonPackageManager.UV,
    );
  });

  it('detects Poetry via [tool.poetry] in pyproject.toml', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      '[tool.poetry]\nname = "myapp"\n',
      'utf-8',
    );
    expect(await detectPackageManager(options(tmpDir))).toBe(
      PythonPackageManager.POETRY,
    );
  });

  it('detects PDM via [tool.pdm] in pyproject.toml', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      '[tool.pdm]\n',
      'utf-8',
    );
    expect(await detectPackageManager(options(tmpDir))).toBe(
      PythonPackageManager.PDM,
    );
  });

  it('detects Hatch via [tool.hatch] in pyproject.toml', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      '[tool.hatch]\n',
      'utf-8',
    );
    expect(await detectPackageManager(options(tmpDir))).toBe(
      PythonPackageManager.HATCH,
    );
  });

  it('detects Rye via [tool.rye] in pyproject.toml', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      '[tool.rye]\n',
      'utf-8',
    );
    expect(await detectPackageManager(options(tmpDir))).toBe(
      PythonPackageManager.RYE,
    );
  });

  it('detects Poetry via poetry.lock file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'poetry.lock'), '', 'utf-8');
    expect(await detectPackageManager(options(tmpDir))).toBe(
      PythonPackageManager.POETRY,
    );
  });

  it('detects PDM via pdm.lock file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'pdm.lock'), '', 'utf-8');
    expect(await detectPackageManager(options(tmpDir))).toBe(
      PythonPackageManager.PDM,
    );
  });

  it('detects Pipenv via Pipfile', async () => {
    fs.writeFileSync(path.join(tmpDir, 'Pipfile'), '', 'utf-8');
    expect(await detectPackageManager(options(tmpDir))).toBe(
      PythonPackageManager.PIPENV,
    );
  });

  it('detects Conda via environment.yml', async () => {
    fs.writeFileSync(path.join(tmpDir, 'environment.yml'), '', 'utf-8');
    expect(await detectPackageManager(options(tmpDir))).toBe(
      PythonPackageManager.CONDA,
    );
  });

  it('detects pip via requirements.txt', async () => {
    fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), '', 'utf-8');
    expect(await detectPackageManager(options(tmpDir))).toBe(
      PythonPackageManager.PIP,
    );
  });

  it('returns UNKNOWN when no indicator files are present', async () => {
    expect(await detectPackageManager(options(tmpDir))).toBe(
      PythonPackageManager.UNKNOWN,
    );
  });
});
