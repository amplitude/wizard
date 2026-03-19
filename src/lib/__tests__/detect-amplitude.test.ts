import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { detectAmplitudeInProject } from '../detect-amplitude.js';

// ── helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-amp-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writePkg(
  deps: Record<string, string> = {},
  devDeps: Record<string, string> = {},
) {
  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ dependencies: deps, devDependencies: devDeps }),
    'utf-8',
  );
}

function writeFile(rel: string, content: string) {
  const abs = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

// ── package.json checks ───────────────────────────────────────────────────────

describe('detectAmplitudeInProject — package.json', () => {
  it('returns high confidence when @amplitude/analytics-browser is in dependencies', () => {
    writePkg({ '@amplitude/analytics-browser': '^2.0.0' });
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('@amplitude/analytics-browser');
  });

  it('returns high confidence when @amplitude/analytics-node is in dependencies', () => {
    writePkg({ '@amplitude/analytics-node': '^1.0.0' });
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('high');
  });

  it('returns high confidence when amplitude-js is in devDependencies', () => {
    writePkg({}, { 'amplitude-js': '^8.0.0' });
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('high');
  });

  it('returns high confidence for @amplitude/analytics-react-native', () => {
    writePkg({ '@amplitude/analytics-react-native': '^1.0.0' });
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('high');
  });

  it('returns high confidence for @amplitude/unified', () => {
    writePkg({ '@amplitude/unified': '^1.0.0' });
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('high');
  });

  it('returns none when package.json has no amplitude packages', () => {
    writePkg({ react: '^18.0.0', lodash: '^4.0.0' });
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('none');
  });

  it('returns none when package.json is absent', () => {
    const result = detectAmplitudeInProject(tmpDir);
    // Falls through to grep (no source files) → none
    expect(result.confidence).toBe('none');
    expect(result.reason).toBeNull();
  });
});

// ── Python requirements checks ────────────────────────────────────────────────

describe('detectAmplitudeInProject — Python requirements', () => {
  it('returns high confidence when amplitude-analytics is in requirements.txt', () => {
    writeFile(
      'requirements.txt',
      'amplitude-analytics==1.1.2\nrequests>=2.0\n',
    );
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('requirements.txt');
  });

  it('returns high confidence when amplitude-analytics is in requirements-dev.txt', () => {
    writeFile('requirements-dev.txt', 'amplitude-analytics==1.1.2\n');
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('high');
  });

  it('returns high confidence when amplitude_analytics is in requirements.txt (underscore variant)', () => {
    writeFile('requirements.txt', 'amplitude_analytics>=1.0\n');
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('high');
  });

  it('returns high confidence when amplitude-analytics is in pyproject.toml', () => {
    writeFile(
      'pyproject.toml',
      '[tool.poetry.dependencies]\namplitude-analytics = "^1.0"\n',
    );
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('pyproject.toml');
  });

  it('returns high confidence when amplitude-analytics is in setup.cfg', () => {
    writeFile(
      'setup.cfg',
      '[options]\ninstall_requires =\n  amplitude-analytics\n',
    );
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('setup.cfg');
  });

  it('returns high confidence when amplitude-analytics is in setup.py', () => {
    // The regex matches lines starting with amplitude[-_]analytics (e.g. requirements-style entries)
    writeFile('setup.py', 'amplitude-analytics>=1.0\n');
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('setup.py');
  });

  it('returns none when requirements files contain unrelated packages', () => {
    writeFile('requirements.txt', 'flask>=2.0\nrequests>=2.0\n');
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('none');
  });
});

// ── Source file grep ──────────────────────────────────────────────────────────

describe('detectAmplitudeInProject — source file grep', () => {
  it('returns low confidence when a JS file imports @amplitude', () => {
    writeFile(
      'src/analytics.js',
      `import { track } from '@amplitude/analytics-browser';\n`,
    );
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('low');
    expect(result.reason).toContain('src/analytics.js');
  });

  it('returns low confidence when a TS file imports @amplitude', () => {
    writeFile(
      'src/analytics.ts',
      `import amplitude from '@amplitude/analytics-node';\n`,
    );
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('low');
  });

  it('returns low confidence when a JS file uses require("amplitude")', () => {
    writeFile('src/tracker.js', `const amplitude = require('amplitude-js');\n`);
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('low');
  });

  it('returns low confidence when a Python file imports amplitude', () => {
    writeFile('app.py', 'from amplitude import BaseEvent\n');
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('low');
  });

  it('skips node_modules when grepping', () => {
    writeFile(
      'node_modules/@amplitude/analytics-browser/index.js',
      `import { track } from '@amplitude/analytics-browser';\n`,
    );
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('none');
  });

  it('returns none when source files contain no amplitude imports', () => {
    writeFile(
      'src/app.ts',
      `import React from 'react';\nconsole.log('hello');\n`,
    );
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('none');
  });
});

// ── Priority ordering ─────────────────────────────────────────────────────────

describe('detectAmplitudeInProject — priority', () => {
  it('returns high (package.json) before checking source files', () => {
    writePkg({ '@amplitude/analytics-browser': '^2.0.0' });
    writeFile(
      'src/app.ts',
      `import amplitude from '@amplitude/analytics-browser';\n`,
    );
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('package.json');
  });
});
