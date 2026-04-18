/**
 * PR 1.2 — anonymousId survives across Analytics instantiations.
 *
 * Uses the real ampli-settings implementation against a tmpdir config file
 * rather than mocking, to catch regressions in the persistence path itself.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock Amplitude SDK to keep the test network-free.
vi.mock('@amplitude/analytics-node', () => ({
  createInstance: vi.fn(() => ({
    init: vi.fn(() => ({ promise: Promise.resolve() })),
    track: vi.fn(),
    identify: vi.fn(),
    setGroup: vi.fn(),
    groupIdentify: vi.fn(),
    flush: vi.fn(() => ({ promise: Promise.resolve() })),
    setOptOut: vi.fn(),
  })),
  Identify: class {
    set = vi.fn();
    setOnce = vi.fn();
  },
}));

vi.mock('../../lib/observability', () => ({
  getSessionId: vi.fn().mockReturnValue('s'),
  getRunId: vi.fn().mockReturnValue('r'),
  getAttemptId: vi.fn().mockReturnValue('a'),
  setSentryUser: vi.fn(),
  createLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  configureLogFile: vi.fn(),
  getLogFilePath: vi.fn().mockReturnValue('/tmp/test.log'),
}));

vi.mock('../../lib/feature-flags', () => ({
  initFeatureFlags: vi.fn().mockResolvedValue(undefined),
  refreshFlags: vi.fn().mockResolvedValue(undefined),
  getFlag: vi.fn().mockReturnValue(undefined),
  getAllFlags: vi.fn().mockReturnValue({}),
  isFlagEnabled: vi.fn().mockReturnValue(false),
  FLAG_AGENT_ANALYTICS: 'wizard-agent-analytics',
  FLAG_LLM_ANALYTICS: 'wizard-llm-analytics',
}));

// Re-point the ampli config to a tmpdir file so the test doesn't touch
// ~/.ampli.json. Done by intercepting the module and overriding
// AMPLI_CONFIG_PATH before Analytics loads.
let tmpDir: string;
let tmpConfig: string;

vi.mock('../ampli-settings', async () => {
  const actual = await vi.importActual<typeof import('../ampli-settings')>(
    '../ampli-settings',
  );
  return {
    ...actual,
    // Force every helper to use our tmp config path
    getStoredDeviceId: () => actual.getStoredDeviceId(tmpConfig),
    storeDeviceId: (id: string) => actual.storeDeviceId(id, tmpConfig),
    getStoredFirstRunAt: () => actual.getStoredFirstRunAt(tmpConfig),
    storeFirstRunAt: (iso: string) => actual.storeFirstRunAt(iso, tmpConfig),
  };
});

describe('anonymousId persistence', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wizard-device-id-'));
    tmpConfig = join(tmpDir, 'ampli.json');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reuses the same anonymousId across Analytics instantiations', async () => {
    const { Analytics } = await import('../analytics');
    const a = new Analytics();
    const first = a.getAnonymousId();

    const b = new Analytics();
    const second = b.getAnonymousId();

    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  it('persists a generated id so a fresh file eventually stabilizes', async () => {
    const { Analytics } = await import('../analytics');
    const a = new Analytics();
    const generated = a.getAnonymousId();

    const { getStoredDeviceId } = await import('../ampli-settings');
    expect(getStoredDeviceId()).toBe(generated);
  });
});
