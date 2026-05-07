import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock @ai-sdk/anthropic so we can inspect what the factory passes in without
// pulling the real provider. Same pattern as console-query.test.ts.
const mockCreateAnthropic = vi.fn();
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: (opts: unknown) => mockCreateAnthropic(opts),
}));

import {
  createWizardAiSdkAnthropic,
  ensureV1Suffix,
} from '../wizard-ai-sdk-anthropic.js';

describe('ensureV1Suffix', () => {
  it('appends /v1 when the URL has no version segment', () => {
    expect(ensureV1Suffix('https://core.amplitude.com/wizard')).toBe(
      'https://core.amplitude.com/wizard/v1',
    );
  });

  it('is idempotent when the URL already ends in /v1', () => {
    expect(ensureV1Suffix('https://core.amplitude.com/wizard/v1')).toBe(
      'https://core.amplitude.com/wizard/v1',
    );
  });

  it('respects an existing /vN segment (e.g. /v2)', () => {
    expect(ensureV1Suffix('https://example.com/api/v2')).toBe(
      'https://example.com/api/v2',
    );
  });

  it('strips a trailing slash before appending /v1', () => {
    expect(ensureV1Suffix('https://core.amplitude.com/wizard/')).toBe(
      'https://core.amplitude.com/wizard/v1',
    );
  });

  it('strips multiple trailing slashes before appending /v1', () => {
    expect(ensureV1Suffix('https://core.amplitude.com/wizard///')).toBe(
      'https://core.amplitude.com/wizard/v1',
    );
  });

  it('strips a trailing slash after a /v1 suffix (still idempotent)', () => {
    expect(ensureV1Suffix('https://core.amplitude.com/wizard/v1/')).toBe(
      'https://core.amplitude.com/wizard/v1',
    );
  });

  it('returns undefined when input is undefined', () => {
    expect(ensureV1Suffix(undefined)).toBeUndefined();
  });

  it('returns the empty string unchanged', () => {
    // Empty string is falsy; the helper bails before normalization so callers
    // can pipe through `process.env.ANTHROPIC_BASE_URL` without guarding.
    expect(ensureV1Suffix('')).toBe('');
  });
});

describe('createWizardAiSdkAnthropic — baseURL normalization', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mockCreateAnthropic.mockReset();
  });

  it('normalizes an explicit baseURL via ensureV1Suffix', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    createWizardAiSdkAnthropic({
      baseURL: 'https://core.amplitude.com/wizard',
    });
    expect(mockCreateAnthropic).toHaveBeenCalledTimes(1);
    const opts = mockCreateAnthropic.mock.calls[0][0] as { baseURL?: string };
    expect(opts.baseURL).toBe('https://core.amplitude.com/wizard/v1');
  });

  it('normalizes ANTHROPIC_BASE_URL when no explicit baseURL is provided', () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://core.amplitude.com/wizard');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    createWizardAiSdkAnthropic();
    const opts = mockCreateAnthropic.mock.calls[0][0] as { baseURL?: string };
    expect(opts.baseURL).toBe('https://core.amplitude.com/wizard/v1');
  });

  it('leaves an explicit baseURL that already ends in /v1 untouched', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    createWizardAiSdkAnthropic({
      baseURL: 'https://core.amplitude.com/wizard/v1',
    });
    const opts = mockCreateAnthropic.mock.calls[0][0] as { baseURL?: string };
    expect(opts.baseURL).toBe('https://core.amplitude.com/wizard/v1');
  });

  it('omits baseURL from createAnthropic when neither opts nor env supplies one', () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', '');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    createWizardAiSdkAnthropic();
    const opts = mockCreateAnthropic.mock.calls[0][0] as { baseURL?: string };
    expect(opts.baseURL).toBeUndefined();
  });
});
