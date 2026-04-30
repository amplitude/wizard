import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  detectAmplitudeInProject,
  detectAmplitudeInProjectSource,
  isProjectFullyWired,
} from '../detect-amplitude.js';

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

// ── Swift checks ─────────────────────────────────────────────────────────────

describe('detectAmplitudeInProject — Swift', () => {
  it('returns high confidence when AmplitudeUnified is in Podfile', () => {
    writeFile(
      'Podfile',
      `platform :ios, '13.0'\npod 'AmplitudeUnified', '~> 0.0.0'\n`,
    );
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('Podfile');
  });

  it('returns high confidence when AmplitudeUnified-Swift is in Package.resolved', () => {
    writeFile(
      'Package.resolved',
      JSON.stringify({
        pins: [
          {
            identity: 'AmplitudeUnified-Swift',
            location: 'https://github.com/amplitude/AmplitudeUnified-Swift',
          },
        ],
      }),
    );
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('Package.resolved');
  });

  it('returns low confidence when a .swift file imports AmplitudeUnified', () => {
    writeFile(
      'Sources/App.swift',
      'import AmplitudeUnified\n\nlet amp = Amplitude(apiKey: "key")\n',
    );
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('low');
    expect(result.reason).toContain('.swift');
  });
});

// ── Android / Java (Gradle) checks ───────────────────────────────────────────

describe('detectAmplitudeInProject — Android / Java Gradle', () => {
  it('returns high confidence when analytics-android is in build.gradle', () => {
    writeFile(
      'app/build.gradle',
      `dependencies {\n    implementation 'com.amplitude:analytics-android:1.+'\n}\n`,
    );
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('build.gradle');
  });

  it('returns high confidence when java-sdk is in build.gradle.kts', () => {
    writeFile(
      'build.gradle.kts',
      `dependencies {\n    implementation("com.amplitude:java-sdk:1.13.0")\n}\n`,
    );
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('build.gradle.kts');
  });

  it('returns low confidence when a .kt file references com.amplitude', () => {
    writeFile(
      'app/src/main/java/App.kt',
      'import com.amplitude.android.Amplitude\n\nval amplitude = Amplitude(config)\n',
    );
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('low');
    expect(result.reason).toContain('.kt');
  });

  it('returns low confidence when a .java file references com.amplitude', () => {
    writeFile(
      'src/main/java/App.java',
      'import com.amplitude.Amplitude;\n\nAmplitude client = Amplitude.getInstance();\n',
    );
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('low');
    expect(result.reason).toContain('.java');
  });
});

// ── Flutter checks ───────────────────────────────────────────────────────────

describe('detectAmplitudeInProject — Flutter', () => {
  it('returns high confidence when amplitude_flutter is in pubspec.yaml', () => {
    writeFile(
      'pubspec.yaml',
      'dependencies:\n  flutter:\n    sdk: flutter\n  amplitude_flutter: ^3.0.0\n',
    );
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('pubspec.yaml');
  });

  it('returns low confidence when a .dart file uses amplitude_flutter', () => {
    writeFile(
      'lib/main.dart',
      "import 'package:amplitude_flutter/amplitude.dart';\n\nfinal amplitude = Amplitude(Configuration(apiKey: 'key'));\n",
    );
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('low');
    expect(result.reason).toContain('.dart');
  });
});

// ── Go checks ────────────────────────────────────────────────────────────────

describe('detectAmplitudeInProject — Go', () => {
  it('returns high confidence when analytics-go is in go.mod', () => {
    writeFile(
      'go.mod',
      'module myapp\n\ngo 1.21\n\nrequire github.com/amplitude/analytics-go v1.0.0\n',
    );
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('go.mod');
  });

  it('returns low confidence when a .go file imports analytics-go', () => {
    writeFile(
      'main.go',
      `import "github.com/amplitude/analytics-go/amplitude"\n\nclient := amplitude.NewClient(config)\n`,
    );
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('low');
    expect(result.reason).toContain('.go');
  });
});

// ── Unreal Engine checks ─────────────────────────────────────────────────────

describe('detectAmplitudeInProject — Unreal Engine', () => {
  it('returns high confidence when AmplitudeApiKey is in DefaultEngine.ini', () => {
    writeFile(
      'Config/DefaultEngine.ini',
      '[Analytics]\nProviderModuleName=Amplitude\nAmplitudeApiKey=abc123\n',
    );
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('DefaultEngine.ini');
  });

  it('returns high confidence when AmplitudeUnreal plugin is present', () => {
    writeFile(
      'Plugins/AmplitudeUnreal/Amplitude.uplugin',
      '{"FileVersion": 3, "Version": 1}',
    );
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('Plugins/');
  });
});

// ── Unity checks ─────────────────────────────────────────────────────────────

describe('detectAmplitudeInProject — Unity', () => {
  it('returns high confidence when amplitude/unity-plugin is in Packages/manifest.json', () => {
    writeFile(
      'Packages/manifest.json',
      JSON.stringify({
        dependencies: {
          'com.amplitude.unity-plugin':
            'https://github.com/amplitude/unity-plugin.git?path=/Assets',
        },
      }),
    );
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('manifest.json');
  });

  it('returns high confidence when Assets/Amplitude directory exists', () => {
    writeFile('Assets/Amplitude/Amplitude.cs', '// Amplitude Unity SDK\n');
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('Assets/Amplitude/');
  });

  it('returns low confidence when a .cs file uses Amplitude.getInstance', () => {
    writeFile(
      'Assets/Scripts/Analytics.cs',
      'Amplitude amplitude = Amplitude.getInstance();\namplitude.init("key");\n',
    );
    const result = detectAmplitudeInProject(tmpDir);
    expect(result.confidence).toBe('low');
    expect(result.reason).toContain('.cs');
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

// ── Source-only detection ────────────────────────────────────────────────────

describe('detectAmplitudeInProjectSource — source-only', () => {
  // Regression for the "wizard says project is fully set up but the SDK file
  // is gone" bug: a stale package.json dep must NOT be treated as evidence
  // that the SDK is wired up.
  it('returns none when package.json lists Amplitude but no source imports it', () => {
    writePkg({ '@amplitude/unified': '^1.0.0' });
    writeFile('src/index.ts', `console.log('hello');\n`);
    const result = detectAmplitudeInProjectSource(tmpDir);
    expect(result.confidence).toBe('none');
  });

  it('returns low when a source file imports an Amplitude SDK', () => {
    writeFile(
      'src/amplitude.ts',
      `import { initAll } from '@amplitude/unified';\n`,
    );
    const result = detectAmplitudeInProjectSource(tmpDir);
    expect(result.confidence).toBe('low');
    expect(result.reason).toContain('amplitude');
  });

  it('ignores Amplitude imports inside node_modules', () => {
    writeFile(
      'node_modules/some-lib/index.js',
      `const a = require('@amplitude/analytics-browser');\n`,
    );
    const result = detectAmplitudeInProjectSource(tmpDir);
    expect(result.confidence).toBe('none');
  });
});

// ── isProjectFullyWired — Activation Check pre-flight ─────────────────────

function writeAmpliConfig(scope: {
  OrgId?: string;
  ProjectId?: string;
  Zone?: string;
}) {
  fs.writeFileSync(
    path.join(tmpDir, 'ampli.json'),
    JSON.stringify(scope),
    'utf-8',
  );
}

function writeEventPlan(
  events: Array<{ name: string; description: string }>,
  rel = '.amplitude/events.json',
) {
  const abs = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(events), 'utf-8');
}

describe('isProjectFullyWired — Activation pre-flight', () => {
  it('returns true when all four signals are present (canonical event-plan path)', () => {
    writePkg({ '@amplitude/unified': '^1.0.0' });
    writeFile(
      'src/lib/amplitude.ts',
      `import { track } from '@amplitude/unified';\n`,
    );
    writeAmpliConfig({ OrgId: '36958', ProjectId: 'abc', Zone: 'us' });
    writeEventPlan([{ name: 'Deploy Clicked', description: '...' }]);

    const result = isProjectFullyWired(tmpDir);
    expect(result.fullyWired).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.present.sort()).toEqual(
      ['ampliConfig', 'dependency', 'eventPlan', 'sourceImport'].sort(),
    );
  });

  it('accepts the legacy root-level .amplitude-events.json event-plan location', () => {
    writePkg({ '@amplitude/unified': '^1.0.0' });
    writeFile('src/index.ts', `import { track } from '@amplitude/unified';\n`);
    writeAmpliConfig({ OrgId: 'o', ProjectId: 'p' });
    writeEventPlan([{ name: 'X', description: 'y' }], '.amplitude-events.json');

    expect(isProjectFullyWired(tmpDir).fullyWired).toBe(true);
  });

  it('returns false when ampli.json has only OrgId (missing ProjectId)', () => {
    writePkg({ '@amplitude/unified': '^1.0.0' });
    writeFile('src/index.ts', `import { track } from '@amplitude/unified';\n`);
    writeAmpliConfig({ OrgId: 'o' }); // ProjectId missing
    writeEventPlan([{ name: 'X', description: 'y' }]);

    const result = isProjectFullyWired(tmpDir);
    expect(result.fullyWired).toBe(false);
    expect(result.missing).toContain('ampliConfig');
  });

  it('returns false when event plan is an empty array', () => {
    writePkg({ '@amplitude/unified': '^1.0.0' });
    writeFile('src/index.ts', `import { track } from '@amplitude/unified';\n`);
    writeAmpliConfig({ OrgId: 'o', ProjectId: 'p' });
    writeEventPlan([]); // empty

    const result = isProjectFullyWired(tmpDir);
    expect(result.fullyWired).toBe(false);
    expect(result.missing).toContain('eventPlan');
  });

  it('returns false when package.json declares the dep but no source imports it', () => {
    // Stale install — package.json has the dep but the SDK file was deleted.
    // This is the same regression detectAmplitudeInProjectSource was added
    // to catch; isProjectFullyWired must inherit that protection.
    writePkg({ '@amplitude/unified': '^1.0.0' });
    writeFile('src/index.ts', `console.log('hello');\n`); // no Amplitude import
    writeAmpliConfig({ OrgId: 'o', ProjectId: 'p' });
    writeEventPlan([{ name: 'X', description: 'y' }]);

    const result = isProjectFullyWired(tmpDir);
    expect(result.fullyWired).toBe(false);
    expect(result.missing).toContain('sourceImport');
  });

  it('returns false on a brand-new project (no signals)', () => {
    writePkg({});
    const result = isProjectFullyWired(tmpDir);
    expect(result.fullyWired).toBe(false);
    expect(result.missing.sort()).toEqual(
      ['ampliConfig', 'dependency', 'eventPlan', 'sourceImport'].sort(),
    );
  });

  it('does not throw on malformed ampli.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'ampli.json'), '{not valid', 'utf-8');
    expect(() => isProjectFullyWired(tmpDir)).not.toThrow();
    expect(isProjectFullyWired(tmpDir).signals.ampliConfig).toBe(false);
  });
});
