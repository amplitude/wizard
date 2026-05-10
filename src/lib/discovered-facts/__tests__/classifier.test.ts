/**
 * Unit coverage for the LLM-powered discovered-facts classifier.
 *
 * The classifier delegates to a Haiku `generateObject` call, so tests mock
 * the `ai` + `@ai-sdk/anthropic` imports and verify:
 *   - Prompt construction includes the right dependency + directory signals
 *   - LLM response is correctly threaded through to the return value
 *   - Errors degrade gracefully (both fields → null, no throw)
 *   - Null packageJson or empty deps short-circuit without an LLM call
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { PackageDotJson } from '../../../utils/package-json.js';
import {
  collectDependencyNames,
  collectDirectorySignals,
  buildClassificationPrompt,
  inferProjectFacts,
  type LlmClassifierConfig,
  type ProjectFacts,
} from '../classifier.js';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockGenerateObject = vi.fn();

vi.mock('ai', () => ({
  generateObject: (...args: unknown[]) => mockGenerateObject(...args),
}));

const mockCreateAnthropic = vi.fn(() => (modelId: string) => ({
  modelId,
  provider: 'anthropic',
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: (...args: unknown[]) => mockCreateAnthropic(...args),
}));

vi.mock('../../gateway-request-sanitize.js', () => ({
  sanitizingFetch: globalThis.fetch,
}));

vi.mock('../../agent/model-config.js', () => ({
  HAIKU_MODEL_DIRECT: 'claude-haiku-4-5-20251001',
  HAIKU_MODEL_GATEWAY: 'anthropic/claude-haiku-4-5-20251001',
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

const NO_DIR = '/__no_such_install_dir__/should_not_exist';

function pkg(deps: Record<string, string>): PackageDotJson {
  return { dependencies: deps };
}

const gatewayConfig: LlmClassifierConfig = {
  baseURL: 'https://core.amplitude.com/wizard/v1',
  authToken: 'test-token',
};

const directConfig: LlmClassifierConfig = {
  apiKey: 'sk-ant-test-key',
};

function mockLlmResponse(facts: ProjectFacts): void {
  mockGenerateObject.mockResolvedValueOnce({ object: facts });
}

function mockLlmError(message: string): void {
  mockGenerateObject.mockRejectedValueOnce(new Error(message));
}

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('collectDependencyNames', () => {
  it('merges deps, devDeps, and optionalDeps into a sorted deduplicated list', () => {
    const result = collectDependencyNames({
      dependencies: { react: '^18.0.0', lodash: '^4.0.0' },
      devDependencies: { vitest: '^1.0.0', react: '^18.0.0' },
      optionalDependencies: { fsevents: '^2.0.0' },
    });
    expect(result).toEqual(['fsevents', 'lodash', 'react', 'vitest']);
  });

  it('returns empty array for no dependencies', () => {
    expect(collectDependencyNames({})).toEqual([]);
  });
});

describe('collectDirectorySignals', () => {
  let tmpDir: string;

  it('detects present directories', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'classifier-test-'));
    fs.mkdirSync(path.join(tmpDir, 'app', 'api'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'src', 'pages', 'api'), {
      recursive: true,
    });

    const signals = collectDirectorySignals(tmpDir);
    expect(signals['app/api']).toBe(true);
    expect(signals['pages/api']).toBe(false);
    expect(signals['src/app/api']).toBe(false);
    expect(signals['src/pages/api']).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports all absent for a nonexistent directory', () => {
    const signals = collectDirectorySignals(NO_DIR);
    expect(Object.values(signals).every((v) => v === false)).toBe(true);
  });
});

describe('buildClassificationPrompt', () => {
  it('includes dependency names and directory signals', () => {
    const prompt = buildClassificationPrompt(['express', 'react', 'stripe'], {
      'app/api': true,
      'pages/api': false,
      'src/app/api': false,
      'src/pages/api': false,
    });
    expect(prompt).toContain('express, react, stripe');
    expect(prompt).toContain('app/api: present');
    expect(prompt).toContain('pages/api: absent');
  });

  it('contains classification guidance', () => {
    const prompt = buildClassificationPrompt(['next'], {
      'app/api': false,
      'pages/api': false,
      'src/app/api': false,
      'src/pages/api': false,
    });
    expect(prompt).toContain('vertical');
    expect(prompt).toContain('appType');
    expect(prompt).toContain('Ecommerce');
    expect(prompt).toContain('Full-stack web');
  });
});

describe('inferProjectFacts', () => {
  it('returns LLM-inferred vertical and appType', async () => {
    mockLlmResponse({ vertical: 'Ecommerce', appType: 'Full-stack web' });

    const result = await inferProjectFacts(
      pkg({ stripe: '^15.0.0', next: '^14.0.0' }),
      NO_DIR,
      gatewayConfig,
    );

    expect(result).toEqual({
      vertical: 'Ecommerce',
      appType: 'Full-stack web',
    });
    expect(mockGenerateObject).toHaveBeenCalledOnce();
  });

  it('passes gateway auth to the Anthropic provider', async () => {
    mockLlmResponse({ vertical: 'SaaS', appType: null });

    await inferProjectFacts(
      pkg({ 'next-auth': '^4.24.0' }),
      NO_DIR,
      gatewayConfig,
    );

    expect(mockCreateAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://core.amplitude.com/wizard/v1',
        authToken: 'test-token',
      }),
    );
  });

  it('passes direct API key when configured', async () => {
    mockLlmResponse({ vertical: 'AI app', appType: 'SPA web' });

    await inferProjectFacts(pkg({ openai: '^4.0.0' }), NO_DIR, directConfig);

    expect(mockCreateAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-ant-test-key' }),
    );
  });

  it('uses gateway model format for gateway auth', async () => {
    mockLlmResponse({ vertical: null, appType: null });

    await inferProjectFacts(pkg({ react: '^18.0.0' }), NO_DIR, gatewayConfig);

    const callArgs = mockGenerateObject.mock.calls[0][0];
    expect(callArgs.model.modelId).toBe('anthropic/claude-haiku-4-5-20251001');
  });

  it('uses direct model format for direct API key', async () => {
    mockLlmResponse({ vertical: null, appType: null });

    await inferProjectFacts(pkg({ react: '^18.0.0' }), NO_DIR, directConfig);

    const callArgs = mockGenerateObject.mock.calls[0][0];
    expect(callArgs.model.modelId).toBe('claude-haiku-4-5-20251001');
  });

  it('returns both null when packageJson is null', async () => {
    const result = await inferProjectFacts(null, NO_DIR, gatewayConfig);
    expect(result).toEqual({ vertical: null, appType: null });
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it('returns both null when dependencies are empty', async () => {
    const result = await inferProjectFacts({}, NO_DIR, gatewayConfig);
    expect(result).toEqual({ vertical: null, appType: null });
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it('degrades gracefully on LLM error (returns null, does not throw)', async () => {
    mockLlmError('network timeout');

    const result = await inferProjectFacts(
      pkg({ stripe: '^15.0.0' }),
      NO_DIR,
      gatewayConfig,
    );

    expect(result).toEqual({ vertical: null, appType: null });
  });

  it('includes dependency names in the prompt sent to the LLM', async () => {
    mockLlmResponse({ vertical: 'Ecommerce', appType: null });

    await inferProjectFacts(
      pkg({ stripe: '^15.0.0', react: '^18.0.0' }),
      NO_DIR,
      gatewayConfig,
    );

    const callArgs = mockGenerateObject.mock.calls[0][0];
    expect(callArgs.prompt).toContain('react');
    expect(callArgs.prompt).toContain('stripe');
  });

  it('includes directory signals in the prompt sent to the LLM', async () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'classifier-prompt-test-'),
    );
    try {
      fs.mkdirSync(path.join(tmpDir, 'app', 'api'), { recursive: true });
      mockLlmResponse({ vertical: null, appType: 'Full-stack web' });

      await inferProjectFacts(pkg({ next: '^14.0.0' }), tmpDir, gatewayConfig);

      const callArgs = mockGenerateObject.mock.calls[0][0];
      expect(callArgs.prompt).toContain('app/api: present');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles LLM returning partial null (one field set, one null)', async () => {
    mockLlmResponse({ vertical: 'AI app', appType: null });

    const result = await inferProjectFacts(
      pkg({ openai: '^4.0.0' }),
      NO_DIR,
      gatewayConfig,
    );

    expect(result).toEqual({ vertical: 'AI app', appType: null });
  });
});
