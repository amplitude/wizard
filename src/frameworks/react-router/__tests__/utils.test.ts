import { describe, it, expect } from 'vitest';
import { getReactRouterModeName, ReactRouterMode } from '../utils.js';

// ── getReactRouterModeName ────────────────────────────────────────────────────

describe('getReactRouterModeName', () => {
  it('returns "v6" for V6', () => {
    expect(getReactRouterModeName(ReactRouterMode.V6)).toBe('v6');
  });

  it('returns "v7 Framework mode" for V7_FRAMEWORK', () => {
    expect(getReactRouterModeName(ReactRouterMode.V7_FRAMEWORK)).toBe(
      'v7 Framework mode',
    );
  });

  it('returns "v7 Data mode" for V7_DATA', () => {
    expect(getReactRouterModeName(ReactRouterMode.V7_DATA)).toBe(
      'v7 Data mode',
    );
  });

  it('returns "v7 Declarative mode" for V7_DECLARATIVE', () => {
    expect(getReactRouterModeName(ReactRouterMode.V7_DECLARATIVE)).toBe(
      'v7 Declarative mode',
    );
  });
});
