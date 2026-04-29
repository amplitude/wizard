/**
 * Unit tests for the setup-complete registry.
 *
 * The registry is module-level state, so each test resets it via
 * `resetSetupComplete()` in `beforeEach`. The registry has no I/O and
 * no UI dependencies — these tests exercise the merge / consume / reset
 * contract end-to-end without standing up the wizard.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerSetupComplete,
  consumeSetupComplete,
  resetSetupComplete,
  dashboardIdFromUrl,
  _peekSetupCompleteForTests,
} from '../setup-complete-registry.js';

describe('setup-complete-registry', () => {
  beforeEach(() => {
    resetSetupComplete();
  });

  it('returns null from consume when nothing was registered', () => {
    expect(consumeSetupComplete()).toBeNull();
  });

  it('shallow-merges amplitude scope across multiple calls', () => {
    registerSetupComplete({ amplitude: { region: 'us', orgId: 'org-1' } });
    registerSetupComplete({
      amplitude: { appId: 'app-7', appName: 'TodoMVC' },
    });
    registerSetupComplete({ amplitude: { envName: 'Production' } });

    const out = consumeSetupComplete();
    expect(out?.amplitude).toEqual({
      region: 'us',
      orgId: 'org-1',
      appId: 'app-7',
      appName: 'TodoMVC',
      envName: 'Production',
    });
  });

  it('later amplitude values override earlier ones for the same key', () => {
    registerSetupComplete({ amplitude: { appId: 'old' } });
    registerSetupComplete({ amplitude: { appId: 'new' } });
    expect(consumeSetupComplete()?.amplitude.appId).toBe('new');
  });

  it('concatenates and de-duplicates files across multiple calls', () => {
    registerSetupComplete({
      files: { written: ['a.js'], modified: ['b.js'] },
    });
    registerSetupComplete({
      files: { written: ['a.js', 'c.js'], modified: [] },
    });
    registerSetupComplete({
      files: { written: [], modified: ['b.js', 'd.js'] },
    });

    const out = consumeSetupComplete();
    expect(out?.files?.written.sort()).toEqual(['a.js', 'c.js']);
    expect(out?.files?.modified.sort()).toEqual(['b.js', 'd.js']);
  });

  it('replaces events list on each call (last writer wins)', () => {
    registerSetupComplete({
      events: [{ name: 'A' }, { name: 'B' }],
    });
    registerSetupComplete({
      events: [{ name: 'C' }],
    });
    expect(consumeSetupComplete()?.events).toEqual([{ name: 'C' }]);
  });

  it('consume() drains the registry; second call returns null', () => {
    registerSetupComplete({ amplitude: { appId: 'app-7' } });
    expect(consumeSetupComplete()).not.toBeNull();
    expect(consumeSetupComplete()).toBeNull();
  });

  it('reset() drops a pending payload without emitting', () => {
    registerSetupComplete({ amplitude: { appId: 'app-7' } });
    expect(_peekSetupCompleteForTests()).not.toBeNull();
    resetSetupComplete();
    expect(_peekSetupCompleteForTests()).toBeNull();
    expect(consumeSetupComplete()).toBeNull();
  });
});

describe('dashboardIdFromUrl', () => {
  it('extracts the id from an Amplitude dashboard URL', () => {
    expect(
      dashboardIdFromUrl(
        'https://app.amplitude.com/analytics/acme/dashboard/abc123',
      ),
    ).toBe('abc123');
  });

  it('returns the id even when the URL has a trailing query string', () => {
    expect(
      dashboardIdFromUrl(
        'https://app.amplitude.com/analytics/acme/dashboard/abc123?from=2024-01-01',
      ),
    ).toBe('abc123');
  });

  it('returns the id when the URL has a trailing hash fragment', () => {
    expect(
      dashboardIdFromUrl(
        'https://app.amplitude.com/analytics/acme/dashboard/abc123#charts',
      ),
    ).toBe('abc123');
  });

  it('returns undefined for URLs that do not match the dashboard pattern', () => {
    expect(dashboardIdFromUrl('https://example.com/foo/bar')).toBeUndefined();
    expect(dashboardIdFromUrl('not a url at all')).toBeUndefined();
    expect(dashboardIdFromUrl('')).toBeUndefined();
  });
});
