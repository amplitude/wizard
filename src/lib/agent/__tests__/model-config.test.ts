import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FALLBACK_MODEL_DIRECT,
  FALLBACK_MODEL_GATEWAY,
  HAIKU_MODEL_DIRECT,
  HAIKU_MODEL_GATEWAY,
  sdkStandardFallbackModel,
  selectModel,
} from '../model-config.js';

/**
 * `selectModel` is the single chokepoint that translates `ModelTier` into
 * the actual model alias on the wire. See `docs/internal/agent-mode-flag.md`
 * and `MIGRATION_PLAN.md` strategic posture #10 (model tiering per call site).
 */
describe('selectModel', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the production-default alias for the default tier', () => {
    expect(selectModel('standard', true)).toBe('claude-sonnet-4-6');
    expect(selectModel('standard', false)).toBe('anthropic/claude-sonnet-4-6');
  });

  it('returns the lower-cost alias for the cheap tier', () => {
    expect(selectModel('fast', true)).toBe('claude-haiku-4-5');
    expect(selectModel('fast', false)).toBe('anthropic/claude-haiku-4-5');
  });

  it('returns the higher-capability alias for the expensive tier', () => {
    expect(selectModel('thorough', true)).toBe('claude-opus-4-7');
    expect(selectModel('thorough', false)).toBe('anthropic/claude-opus-4-7');
  });

  it('returns the pinned Haiku alias for the oneshot tier', () => {
    expect(selectModel('oneshot', true)).toBe(HAIKU_MODEL_DIRECT);
    expect(selectModel('oneshot', false)).toBe(HAIKU_MODEL_GATEWAY);
  });

  it('treats an unknown mode as the production default (defensive)', () => {
    expect(selectModel('bogus' as 'standard', true)).toBe('claude-sonnet-4-6');
    expect(selectModel('bogus' as 'standard', false)).toBe(
      'anthropic/claude-sonnet-4-6',
    );
  });

  it('honors WIZARD_CLAUDE_MODEL override on the standard tier', () => {
    vi.stubEnv('WIZARD_CLAUDE_MODEL', 'claude-sonnet-vnext');
    expect(selectModel('standard', true)).toBe('claude-sonnet-vnext');
    expect(selectModel('standard', false)).toBe(
      'anthropic/claude-sonnet-vnext',
    );
  });

  it('honors WIZARD_HAIKU_MODEL override on the oneshot tier', () => {
    vi.stubEnv('WIZARD_HAIKU_MODEL', 'claude-haiku-vnext');
    expect(selectModel('oneshot', true)).toBe('claude-haiku-vnext');
    expect(selectModel('oneshot', false)).toBe('anthropic/claude-haiku-vnext');
  });

  it('ignores empty / whitespace overrides and returns the pinned aliases', () => {
    vi.stubEnv('WIZARD_HAIKU_MODEL', '   ');
    expect(selectModel('oneshot', true)).toBe(HAIKU_MODEL_DIRECT);
    vi.stubEnv('WIZARD_CLAUDE_MODEL', '');
    expect(selectModel('standard', true)).toBe('claude-sonnet-4-6');
  });

  // The SDK rejects a fallback equal to the primary; if an operator pins
  // WIZARD_CLAUDE_MODEL to the fallback alias, the wizard would crash on
  // every run. Defensively ignore such overrides and keep the default.
  it('ignores WIZARD_CLAUDE_MODEL overrides that collide with the SDK fallback', () => {
    vi.stubEnv('WIZARD_CLAUDE_MODEL', FALLBACK_MODEL_DIRECT);
    expect(selectModel('standard', true)).toBe('claude-sonnet-4-6');
    expect(selectModel('standard', false)).toBe('anthropic/claude-sonnet-4-6');
  });

  // The Claude Agent SDK rejects a `fallbackModel` equal to the primary
  // `model` with `Fallback model cannot be the same as the main model`,
  // failing the run before the agent makes any progress. Pin the
  // invariant so a future "modernize the alias" change to either
  // `selectModel` or `FALLBACK_MODEL_*` can't reintroduce BA-111.
  it.each([
    ['standard', true] as const,
    ['standard', false] as const,
    ['fast', true] as const,
    ['fast', false] as const,
    ['thorough', true] as const,
    ['thorough', false] as const,
    ['oneshot', true] as const,
    ['oneshot', false] as const,
  ])(
    'never returns the fallback alias for mode=%s, useDirectApiKey=%s',
    (mode, useDirectApiKey) => {
      const fallback = useDirectApiKey
        ? FALLBACK_MODEL_DIRECT
        : FALLBACK_MODEL_GATEWAY;
      expect(selectModel(mode, useDirectApiKey)).not.toBe(fallback);
    },
  );

  // Tier disjointness: primary (standard) !== fallback !== oneshot. This
  // guards the post-#568 invariant that the inner-loop, gateway-fallback,
  // and one-shot tiers are three distinct aliases on every code path.
  it.each([[true] as const, [false] as const])(
    'standard / fallback / oneshot are pairwise distinct (useDirectApiKey=%s)',
    (useDirectApiKey) => {
      const primary = selectModel('standard', useDirectApiKey);
      const fallback = sdkStandardFallbackModel(useDirectApiKey);
      const oneshot = selectModel('oneshot', useDirectApiKey);
      expect(primary).not.toBe(fallback);
      expect(primary).not.toBe(oneshot);
      expect(fallback).not.toBe(oneshot);
    },
  );
});

describe('sdkStandardFallbackModel', () => {
  it('returns the SDK-distinct fallback alias on the direct path', () => {
    expect(sdkStandardFallbackModel(true)).toBe(FALLBACK_MODEL_DIRECT);
  });

  it('returns the SDK-distinct fallback alias on the gateway path', () => {
    expect(sdkStandardFallbackModel(false)).toBe(FALLBACK_MODEL_GATEWAY);
  });

  // BA-111: the fallback MUST be distinct from the primary `selectModel`
  // value for every mode the wizard ships, or the SDK aborts every run.
  it.each([
    ['standard', true] as const,
    ['standard', false] as const,
    ['fast', true] as const,
    ['fast', false] as const,
    ['thorough', true] as const,
    ['thorough', false] as const,
    ['oneshot', true] as const,
    ['oneshot', false] as const,
  ])(
    'is distinct from selectModel for mode=%s, useDirectApiKey=%s',
    (mode, useDirectApiKey) => {
      expect(sdkStandardFallbackModel(useDirectApiKey)).not.toBe(
        selectModel(mode, useDirectApiKey),
      );
    },
  );
});

describe('HAIKU_MODEL_*', () => {
  it('pins the Haiku alias on direct and gateway paths', () => {
    expect(HAIKU_MODEL_DIRECT).toBe('claude-haiku-4-5-20251001');
    expect(HAIKU_MODEL_GATEWAY).toBe('anthropic/claude-haiku-4-5-20251001');
  });
});
