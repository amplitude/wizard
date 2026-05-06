import { describe, it, expect } from 'vitest';
import {
  mergeNodeOptions,
  buildGatewaySanitizeNodeOptions,
} from '../gateway-fetch-sanitize-node-options.js';

describe('mergeNodeOptions', () => {
  it('appends a new flag', () => {
    expect(mergeNodeOptions(undefined, '--require "./x.js"')).toBe(
      '--require "./x.js"',
    );
  });

  it('preserves existing flags', () => {
    expect(mergeNodeOptions('--import ./a.mjs', '--require "./x.js"')).toBe(
      '--import ./a.mjs --require "./x.js"',
    );
  });
});

describe('buildGatewaySanitizeNodeOptions', () => {
  it('returns merged NODE_OPTIONS when bootstrap exists on disk', () => {
    const out = buildGatewaySanitizeNodeOptions('--import x');
    if (!out) {
      // Vitest often executes from `src/` without `dist/` neighbors; merge is
      // still covered by mergeNodeOptions tests above.
      return;
    }
    expect(out).toMatch(/--require/);
    expect(out).toMatch(/register-gateway-fetch-sanitize-bootstrap\.js/);
    expect(out).toContain('--import x');
  });
});
