import { describe, it, expect } from 'vitest';
import {
  FALLBACK_MODEL_DIRECT,
  FALLBACK_MODEL_GATEWAY,
  sdkStandardFallbackModel,
  selectModel,
} from '../model-config.js';

/**
 * `selectModel` is the single chokepoint that translates `WizardMode` into
 * the actual model alias on the wire. See `docs/internal/agent-mode-flag.md`.
 */
describe('selectModel', () => {
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

  it('treats an unknown mode as the production default (defensive)', () => {
    expect(selectModel('bogus' as 'standard', true)).toBe('claude-sonnet-4-6');
    expect(selectModel('bogus' as 'standard', false)).toBe(
      'anthropic/claude-sonnet-4-6',
    );
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
  ])(
    'never returns the fallback alias for mode=%s, useDirectApiKey=%s',
    (mode, useDirectApiKey) => {
      const fallback = useDirectApiKey
        ? FALLBACK_MODEL_DIRECT
        : FALLBACK_MODEL_GATEWAY;
      expect(selectModel(mode, useDirectApiKey)).not.toBe(fallback);
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
  ])(
    'is distinct from selectModel for mode=%s, useDirectApiKey=%s',
    (mode, useDirectApiKey) => {
      expect(sdkStandardFallbackModel(useDirectApiKey)).not.toBe(
        selectModel(mode, useDirectApiKey),
      );
    },
  );
});
