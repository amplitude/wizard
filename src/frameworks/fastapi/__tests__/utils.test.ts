import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getFastAPIProjectTypeName,
  getFastAPIVersionBucket,
  getFastAPIVersion,
  FastAPIProjectType,
} from '../utils.js';

// ── getFastAPIProjectTypeName ─────────────────────────────────────────────────

describe('getFastAPIProjectTypeName', () => {
  it('returns "Standard FastAPI" for STANDARD', () => {
    expect(getFastAPIProjectTypeName(FastAPIProjectType.STANDARD)).toBe(
      'Standard FastAPI',
    );
  });

  it('returns "FastAPI with APIRouter" for ROUTER', () => {
    expect(getFastAPIProjectTypeName(FastAPIProjectType.ROUTER)).toBe(
      'FastAPI with APIRouter',
    );
  });

  it('returns "FastAPI Fullstack" for FULLSTACK', () => {
    expect(getFastAPIProjectTypeName(FastAPIProjectType.FULLSTACK)).toBe(
      'FastAPI Fullstack',
    );
  });
});

// ── getFastAPIVersionBucket ───────────────────────────────────────────────────

describe('getFastAPIVersionBucket', () => {
  it('returns "none" for undefined', () => {
    expect(getFastAPIVersionBucket(undefined)).toBe('none');
  });

  it('returns "0.x" for a 0.x version', () => {
    expect(getFastAPIVersionBucket('0.109.0')).toBe('0.x');
  });

  it('returns "1.x" for a 1.x version', () => {
    expect(getFastAPIVersionBucket('1.0.0')).toBe('1.x');
  });

  it('returns "0.x" for a range like ">=0.100"', () => {
    expect(getFastAPIVersionBucket('>=0.100')).toBe('0.x');
  });

  it('returns "unknown" for a completely invalid string', () => {
    expect(getFastAPIVersionBucket('not-a-version')).toBe('unknown');
  });
});

// ── getFastAPIVersion ─────────────────────────────────────────────────────────

describe('getFastAPIVersion', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fastapi-utils-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts version from requirements.txt (==)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'requirements.txt'),
      'fastapi==0.109.0\n',
      'utf-8',
    );
    expect(await getFastAPIVersion({ installDir: tmpDir })).toBe('0.109.0');
  });

  it('extracts version case-insensitively (FastAPI>=)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'requirements.txt'),
      'FastAPI>=0.100\n',
      'utf-8',
    );
    expect(await getFastAPIVersion({ installDir: tmpDir })).toBe('0.100');
  });

  it('extracts version from pyproject.toml', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      '[project]\ndependencies = ["fastapi>=0.100.0"]\n',
      'utf-8',
    );
    expect(await getFastAPIVersion({ installDir: tmpDir })).toBe('0.100.0');
  });

  it('returns undefined when no requirements file mentions FastAPI', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'requirements.txt'),
      'requests==2.28.0\n',
      'utf-8',
    );
    expect(await getFastAPIVersion({ installDir: tmpDir })).toBeUndefined();
  });

  it('returns undefined when no requirements files exist', async () => {
    expect(await getFastAPIVersion({ installDir: tmpDir })).toBeUndefined();
  });
});
