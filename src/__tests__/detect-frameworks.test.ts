import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Integration } from '../lib/constants';
import type { FrameworkConfig } from '../lib/framework-config';

// ── Mocks ──────────────────────────────────────────────────────────────────────

// Capture the detect/version functions per framework so tests can control them
const detectorMocks = new Map<
  Integration,
  {
    detect: ReturnType<typeof vi.fn>;
    getInstalledVersion?: ReturnType<typeof vi.fn>;
    minimumVersion?: string;
  }
>();

function makeConfig(
  integration: Integration,
  overrides: {
    detect?: () => Promise<boolean>;
    getInstalledVersion?: () => Promise<string | undefined>;
    minimumVersion?: string;
  } = {},
): FrameworkConfig {
  const detectFn = vi.fn(overrides.detect ?? (async () => false));
  const getInstalledVersionFn = overrides.getInstalledVersion
    ? vi.fn(overrides.getInstalledVersion)
    : undefined;

  detectorMocks.set(integration, {
    detect: detectFn,
    getInstalledVersion: getInstalledVersionFn,
    minimumVersion: overrides.minimumVersion,
  });

  return {
    detection: {
      packageName: integration,
      packageDisplayName: integration,
      getVersion: () => undefined,
      detect: detectFn,
      getInstalledVersion: getInstalledVersionFn,
      minimumVersion: overrides.minimumVersion,
      detectPackageManager: vi.fn(),
    },
    metadata: {
      name: integration,
      integration,
      docsUrl: '',
    },
    environment: { uploadToHosting: false, getEnvVars: () => ({}) },
    analytics: { getTags: () => ({}) },
    prompts: { projectTypeDetection: '' },
    ui: {
      successMessage: '',
      estimatedDurationMinutes: 1,
      getOutroChanges: () => [],
      getOutroNextSteps: () => [],
    },
  } as unknown as FrameworkConfig;
}

// Build a registry with all integrations defaulting to not-detected
function buildRegistry(
  overrides: Partial<
    Record<
      Integration,
      {
        detect?: () => Promise<boolean>;
        getInstalledVersion?: () => Promise<string | undefined>;
        minimumVersion?: string;
      }
    >
  > = {},
): Record<Integration, FrameworkConfig> {
  const registry = {} as Record<Integration, FrameworkConfig>;
  for (const integration of Object.values(Integration)) {
    registry[integration] = makeConfig(integration, overrides[integration]);
  }
  return registry;
}

let registry: Record<Integration, FrameworkConfig>;

vi.mock('../lib/registry', () => ({
  get FRAMEWORK_REGISTRY() {
    return registry;
  },
}));
vi.mock('../utils/debug', () => ({
  logToFile: vi.fn(),
}));
vi.mock('../utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
  },
}));

// Import after mocks are set up
const { detectAllFrameworks } = await import('../run');

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('detectAllFrameworks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    detectorMocks.clear();
  });

  test('returns all frameworks with detected=false when none match', async () => {
    registry = buildRegistry();

    const results = await detectAllFrameworks(process.cwd());

    expect(results).toHaveLength(Object.values(Integration).length);
    expect(results.every((r) => r.detected === false)).toBe(true);
    expect(results.every((r) => r.timedOut === false)).toBe(true);
  });

  test('marks the correct framework as detected', async () => {
    registry = buildRegistry({
      [Integration.nextjs]: { detect: async () => true },
    });

    const results = await detectAllFrameworks(process.cwd());
    const nextjs = results.find((r) => r.integration === Integration.nextjs);

    expect(nextjs?.detected).toBe(true);
    // All others should be false
    expect(results.filter((r) => r.detected).map((r) => r.integration)).toEqual(
      [Integration.nextjs],
    );
  });

  test('detects multiple frameworks simultaneously', async () => {
    registry = buildRegistry({
      [Integration.nextjs]: { detect: async () => true },
      [Integration.vue]: { detect: async () => true },
    });

    const results = await detectAllFrameworks(process.cwd());
    const detected = results.filter((r) => r.detected);

    expect(detected).toHaveLength(2);
    expect(detected.map((r) => r.integration)).toContain(Integration.nextjs);
    expect(detected.map((r) => r.integration)).toContain(Integration.vue);
  });

  test('preserves Integration enum order in results', async () => {
    registry = buildRegistry({
      [Integration.vue]: { detect: async () => true },
      [Integration.nextjs]: { detect: async () => true },
    });

    const results = await detectAllFrameworks(process.cwd());
    const integrationOrder = results.map((r) => r.integration);
    const enumOrder = Object.values(Integration);

    expect(integrationOrder).toEqual(enumOrder);

    // First detected in enum order should be nextjs (comes before vue)
    const firstDetected = results.find((r) => r.detected);
    expect(firstDetected?.integration).toBe(Integration.nextjs);
  });

  test('captures error when detect() throws', async () => {
    registry = buildRegistry({
      [Integration.django]: {
        detect: async () => {
          throw new Error('permission denied');
        },
      },
    });

    const results = await detectAllFrameworks(process.cwd());
    const django = results.find((r) => r.integration === Integration.django);

    expect(django?.detected).toBe(false);
    expect(django?.error).toBe('permission denied');
    expect(django?.timedOut).toBe(false);
  });

  test('times out slow detectors without blocking others', async () => {
    registry = buildRegistry({
      [Integration.nextjs]: { detect: async () => true },
      [Integration.flask]: {
        detect: () => new Promise(() => {}), // never resolves
      },
    });

    const results = await detectAllFrameworks(process.cwd(), 50); // 50ms timeout

    const nextjs = results.find((r) => r.integration === Integration.nextjs);
    expect(nextjs?.detected).toBe(true);
    expect(nextjs?.timedOut).toBe(false);

    const flask = results.find((r) => r.integration === Integration.flask);
    expect(flask?.detected).toBe(false);
    expect(flask?.timedOut).toBe(true);
  });

  test('runs all detectors in parallel (not sequential)', async () => {
    const callOrder: string[] = [];
    registry = buildRegistry({
      [Integration.nextjs]: {
        detect: async () => {
          callOrder.push('nextjs-start');
          await new Promise((r) => setTimeout(r, 20));
          callOrder.push('nextjs-end');
          return true;
        },
      },
      [Integration.django]: {
        detect: async () => {
          callOrder.push('django-start');
          await new Promise((r) => setTimeout(r, 20));
          callOrder.push('django-end');
          return false;
        },
      },
    });

    await detectAllFrameworks(process.cwd());

    // Both should start before either finishes (parallel execution)
    const nextjsStart = callOrder.indexOf('nextjs-start');
    const djangoStart = callOrder.indexOf('django-start');
    const nextjsEnd = callOrder.indexOf('nextjs-end');

    expect(nextjsStart).toBeLessThan(nextjsEnd);
    expect(djangoStart).toBeLessThan(nextjsEnd);
  });

  test('returns all errors when installDir is not readable', async () => {
    registry = buildRegistry();

    const results = await detectAllFrameworks('/nonexistent/path/12345');

    expect(results).toHaveLength(Object.values(Integration).length);
    expect(results.every((r) => r.detected === false)).toBe(true);
    expect(results.every((r) => r.error === 'installDir not readable')).toBe(
      true,
    );
    expect(results.every((r) => r.durationMs === 0)).toBe(true);

    // No detect() functions should have been called
    for (const mock of detectorMocks.values()) {
      expect(mock.detect).not.toHaveBeenCalled();
    }
  });

  test('includes version when getInstalledVersion is defined', async () => {
    registry = buildRegistry({
      [Integration.nextjs]: {
        detect: async () => true,
        getInstalledVersion: async () => '15.3.1',
      },
    });

    const results = await detectAllFrameworks(process.cwd());
    const nextjs = results.find((r) => r.integration === Integration.nextjs);

    expect(nextjs?.detected).toBe(true);
    expect(nextjs?.version).toBe('15.3.1');
  });

  test('captures version even when below minimumVersion (no warning at detection time)', async () => {
    registry = buildRegistry({
      [Integration.nextjs]: {
        detect: async () => true,
        getInstalledVersion: async () => '14.0.0',
        minimumVersion: '15.3.0',
      },
    });

    const results = await detectAllFrameworks(process.cwd());
    const nextjs = results.find((r) => r.integration === Integration.nextjs);

    // Detection captures version but does NOT warn — agent-runner handles that
    expect(nextjs?.detected).toBe(true);
    expect(nextjs?.version).toBe('14.0.0');
  });

  test('handles getInstalledVersion throwing without breaking detection', async () => {
    registry = buildRegistry({
      [Integration.nextjs]: {
        detect: async () => true,
        getInstalledVersion: async () => {
          throw new Error('cannot read node_modules');
        },
        minimumVersion: '15.0.0',
      },
    });

    const results = await detectAllFrameworks(process.cwd());
    const nextjs = results.find((r) => r.integration === Integration.nextjs);

    // Should still be detected, just no version info
    expect(nextjs?.detected).toBe(true);
    expect(nextjs?.version).toBeUndefined();
  });

  test('captures version from getVersionCheckInfo', async () => {
    registry = buildRegistry({
      [Integration.nextjs]: {
        detect: async () => true,
      },
    });
    registry[Integration.nextjs].detection.getVersionCheckInfo = vi
      .fn()
      .mockResolvedValue({
        version: '1.168.10',
        minimumVersion: '1.0.0',
        packageDisplayName: 'TanStack Router',
      });

    const results = await detectAllFrameworks(process.cwd());
    const nextjs = results.find((r) => r.integration === Integration.nextjs);

    expect(nextjs?.version).toBe('1.168.10');
  });

  test('times out slow getInstalledVersion along with detect', async () => {
    registry = buildRegistry({
      [Integration.nextjs]: {
        detect: async () => true,
        getInstalledVersion: () => new Promise(() => {}), // never resolves
      },
    });

    const results = await detectAllFrameworks(process.cwd(), 50);
    const nextjs = results.find((r) => r.integration === Integration.nextjs);

    // The entire work() promise should time out
    expect(nextjs?.timedOut).toBe(true);
    expect(nextjs?.detected).toBe(false);
  });

  test('records durationMs for each detector', async () => {
    registry = buildRegistry({
      [Integration.nextjs]: {
        detect: async () => {
          await new Promise((r) => setTimeout(r, 30));
          return true;
        },
      },
    });

    const results = await detectAllFrameworks(process.cwd());
    const nextjs = results.find((r) => r.integration === Integration.nextjs);

    expect(nextjs?.durationMs).toBeGreaterThanOrEqual(25);
  });
});
