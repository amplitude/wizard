import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

class FixtureTracker {
  private readonly fixturesDir: string;
  private readonly trackingDir: string;
  private readonly existingFixturesFile: string;
  private readonly usedFixturesFile: string;

  /**
   * Currently-active framework scope for fixture read/write operations.
   * When set, fixtures live in `fixtures/<framework>/<hash>.json`.
   * When null, fixtures live in the legacy flat layout: `fixtures/<hash>.json`.
   */
  private currentFramework: string | null = null;

  constructor() {
    this.fixturesDir = this.getFixturesDirectory();
    this.trackingDir = path.join(this.fixturesDir, '.tracking');
    this.existingFixturesFile = path.join(
      this.trackingDir,
      'existing-fixtures.json',
    );
    this.usedFixturesFile = path.join(this.trackingDir, 'used-fixtures.json');
  }

  private getFixturesDirectory(): string {
    const findWizardRoot = (): string => {
      let currentDir = process.cwd();
      const root = path.parse(currentDir).root;

      while (currentDir !== root) {
        if (
          fs.existsSync(path.join(currentDir, 'wizard.config.js')) ||
          fs.existsSync(path.join(currentDir, 'package.json'))
        ) {
          if (path.basename(currentDir) === 'wizard') {
            return currentDir;
          }
        }
        if (path.basename(currentDir) === 'wizard') {
          return currentDir;
        }
        currentDir = path.dirname(currentDir);
      }
      return process.cwd();
    };

    return path.join(findWizardRoot(), 'e2e-tests', 'fixtures');
  }

  /**
   * Set the active framework scope. Subsequent `retrieveQueryFixture` /
   * `saveQueryFixture` / `markFixtureAsUsed` calls will read and write
   * fixtures under `fixtures/<framework>/`. Pass `null` to revert to the
   * legacy flat layout (preserves back-compat).
   *
   * The handler also honors `process.env.E2E_FIXTURE_FRAMEWORK` so tests
   * spawned in separate processes can share the scope.
   */
  setCurrentFramework(framework: string | null): void {
    this.currentFramework = framework;
  }

  getCurrentFramework(): string | null {
    // Prefer the env var (set before spawning the wizard) over in-memory state
    // so framework scoping survives across test/process boundaries.
    const fromEnv = process.env.E2E_FIXTURE_FRAMEWORK;
    if (fromEnv && fromEnv.length > 0) {
      return fromEnv;
    }
    return this.currentFramework;
  }

  /**
   * Resolve the directory that should hold fixtures for the given framework
   * (or the active framework, if none is passed). For back-compat, when the
   * framework is unset this returns the flat fixtures root.
   */
  private resolveFixtureDir(framework?: string | null): string {
    const fw = framework === undefined ? this.getCurrentFramework() : framework;
    if (fw) {
      return path.join(this.fixturesDir, fw);
    }
    return this.fixturesDir;
  }

  /**
   * Lookup path for a given request body. Falls back to the flat-layout path
   * when no per-framework fixture exists so pre-existing fixtures keep working.
   */
  private resolveFixturePath(
    requestBody: string,
    framework?: string | null,
  ): string {
    const hash = this.generateHashFromRequestBody(requestBody);
    const scopedPath = path.join(
      this.resolveFixtureDir(framework),
      `${hash}.json`,
    );
    const flatPath = path.join(this.fixturesDir, `${hash}.json`);

    if (fs.existsSync(scopedPath)) {
      return scopedPath;
    }
    // Back-compat: if a legacy flat fixture exists, use it
    if (fs.existsSync(flatPath)) {
      return flatPath;
    }
    // Default to scoped path for new writes
    return scopedPath;
  }

  captureExistingFixtures(): void {
    if (!fs.existsSync(this.fixturesDir)) {
      return;
    }

    const existingFixtures = new Set<string>();

    // Walk the fixtures dir recursively so we pick up both flat `<hash>.json`
    // files and per-framework `<framework>/<hash>.json` layouts.
    const walk = (dir: string): void => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip the tracking directory
          if (full === this.trackingDir) continue;
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          existingFixtures.add(full);
        }
      }
    };

    walk(this.fixturesDir);

    // Ensure tracking directory exists
    fs.mkdirSync(this.trackingDir, { recursive: true });

    // Write existing fixtures to file
    fs.writeFileSync(
      this.existingFixturesFile,
      JSON.stringify(Array.from(existingFixtures), null, 2),
    );

    // Initialize empty used fixtures file
    fs.writeFileSync(this.usedFixturesFile, JSON.stringify([], null, 2));
  }

  markFixtureAsUsed(requestBody: string, framework?: string | null): void {
    const fixturePath = this.resolveFixturePath(requestBody, framework);

    // Read current used fixtures
    let usedFixtures: string[] = [];
    if (fs.existsSync(this.usedFixturesFile)) {
      try {
        usedFixtures = JSON.parse(
          fs.readFileSync(this.usedFixturesFile, 'utf8'),
        ) as string[];
      } catch {
        usedFixtures = [];
      }
    }

    // Add new fixture if not already tracked
    if (!usedFixtures.includes(fixturePath)) {
      usedFixtures.push(fixturePath);

      // Ensure tracking directory exists
      fs.mkdirSync(this.trackingDir, { recursive: true });

      // Write back to file
      fs.writeFileSync(
        this.usedFixturesFile,
        JSON.stringify(usedFixtures, null, 2),
      );
    }
  }

  cleanupUnusedFixtures(): void {
    let existingFixtures: string[] = [];
    let usedFixtures: string[] = [];

    // Read existing fixtures
    if (fs.existsSync(this.existingFixturesFile)) {
      try {
        existingFixtures = JSON.parse(
          fs.readFileSync(this.existingFixturesFile, 'utf8'),
        ) as string[];
      } catch (error) {
        console.warn('Error reading existing fixtures file:', error);
        return;
      }
    }

    // Read used fixtures
    if (fs.existsSync(this.usedFixturesFile)) {
      try {
        usedFixtures = JSON.parse(
          fs.readFileSync(this.usedFixturesFile, 'utf8'),
        ) as string[];
      } catch (error) {
        console.warn('Error reading used fixtures file:', error);
        usedFixtures = [];
      }
    }

    // Calculate unused fixtures
    const usedFixturesSet = new Set(usedFixtures);
    const unusedFixtures = existingFixtures.filter(
      (fixture) => !usedFixturesSet.has(fixture),
    );

    for (const fixturePath of unusedFixtures) {
      if (fs.existsSync(fixturePath)) {
        fs.unlinkSync(fixturePath);

        console.log(`Deleted unused fixture: ${path.basename(fixturePath)}`);
      }
    }

    // Clean up tracking files
    if (fs.existsSync(this.trackingDir)) {
      fs.rmSync(this.trackingDir, { recursive: true, force: true });
    }
  }

  private generateHashFromRequestBody(requestBody: string): string {
    return crypto.createHash('md5').update(requestBody).digest('hex');
  }

  retrieveQueryFixture(
    requestBody: string,
    framework?: string | null,
  ): unknown | null {
    const fixturePath = this.resolveFixturePath(requestBody, framework);

    if (!fs.existsSync(fixturePath)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  }

  saveQueryFixture(
    requestBody: string,
    response: unknown,
    framework?: string | null,
  ): void {
    const hash = this.generateHashFromRequestBody(requestBody);
    const fixturePath = path.join(
      this.resolveFixtureDir(framework),
      `${hash}.json`,
    );
    fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
    fs.writeFileSync(fixturePath, JSON.stringify(response, null, 2));
  }

  getStats() {
    let existingFixtures: string[] = [];
    let usedFixtures: string[] = [];

    if (fs.existsSync(this.existingFixturesFile)) {
      try {
        existingFixtures = JSON.parse(
          fs.readFileSync(this.existingFixturesFile, 'utf8'),
        ) as string[];
      } catch {
        // Ignore errors
      }
    }

    if (fs.existsSync(this.usedFixturesFile)) {
      try {
        usedFixtures = JSON.parse(
          fs.readFileSync(this.usedFixturesFile, 'utf8'),
        ) as string[];
      } catch {
        // Ignore errors
      }
    }

    return {
      existingFixtures: existingFixtures.length,
      usedFixtures: usedFixtures.length,
      unusedFixtures: existingFixtures.length - usedFixtures.length,
    };
  }
}

export const fixtureTracker = new FixtureTracker();

/**
 * Convenience helper mirroring the instance method. Prefer this in test
 * setup code so the intent (scoping fixtures per-framework) reads clearly
 * at the call site.
 */
export function setCurrentFramework(framework: string | null): void {
  fixtureTracker.setCurrentFramework(framework);
  if (framework) {
    process.env.E2E_FIXTURE_FRAMEWORK = framework;
  } else {
    delete process.env.E2E_FIXTURE_FRAMEWORK;
  }
}
