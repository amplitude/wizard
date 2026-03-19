/**
 * Wizard Proxy — E2E tests via Vitest
 *
 * These tests hit a running proxy and make real LLM calls through Vertex AI.
 * They are tagged with @proxy so they can be excluded from normal `pnpm test`.
 *
 * Usage:
 *   pnpm test:proxy        — run only these proxy e2e tests
 *   pnpm test              — runs unit tests only (proxy tests excluded)
 *
 * Prerequisites:
 *   1. Login: pnpm try login
 *   2. Start the proxy: pnpm proxy
 */

import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';

import { getStoredToken, getStoredUser } from '../utils/ampli-settings';

const PROXY_URL =
  process.env.WIZARD_PROXY_URL || 'http://127.0.0.1:3030/wizard';

// ---------------------------------------------------------------------------
// Auth token resolution
// ---------------------------------------------------------------------------

function resolveAuthToken() {
  const envToken = process.env.WIZARD_PROXY_TEST_TOKEN;
  if (envToken) return { token: envToken, source: 'env' };

  const user = getStoredUser();
  const stored = getStoredToken(user?.id, user?.zone);
  if (stored?.accessToken) {
    return { token: stored.accessToken, source: `ampli (${user?.email})` };
  }

  return { token: 'dev-token', source: 'fallback' };
}

const { token, source } = resolveAuthToken();

function createClient() {
  return new Anthropic({ apiKey: token, baseURL: PROXY_URL });
}

// ---------------------------------------------------------------------------
// Smoke tests — no LLM calls, just proxy connectivity
// ---------------------------------------------------------------------------

describe('proxy:smoke', () => {
  it('health check returns ok', async () => {
    const start = performance.now();
    const res = await fetch(`${PROXY_URL}/health`);
    const elapsed = performance.now() - start;

    expect(res.ok).toBe(true);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
    console.log(`  health: ${elapsed.toFixed(0)}ms`);
  });

  it('GET /v1/models returns model list', async () => {
    const start = performance.now();
    const res = await fetch(`${PROXY_URL}/v1/models`, {
      headers: { 'x-api-key': token },
    });
    const elapsed = performance.now() - start;

    expect(res.ok).toBe(true);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    const ids = body.data.map((m) => m.id);
    expect(ids).toContain('claude-sonnet-4-6');
    expect(ids).toContain('claude-haiku-4-5');
    console.log(`  models: ${ids.join(', ')} (${elapsed.toFixed(0)}ms)`);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await fetch(`${PROXY_URL}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects unknown models', async () => {
    const res = await fetch(`${PROXY_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': token,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// E2E tests — real LLM calls through Vertex AI
// ---------------------------------------------------------------------------

describe('proxy:e2e', () => {
  it('non-streaming: generates Amplitude Browser SDK init code', {
    timeout: 60_000,
  }, async () => {
    const start = performance.now();
    const client = createClient();

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content:
            'Write a TypeScript code snippet that imports the Amplitude Browser SDK ' +
            '(@amplitude/analytics-browser) and initializes it with an API key. ' +
            'Include the import statement and the init() call. Only output the code, no explanation.',
        },
      ],
    });
    const elapsed = performance.now() - start;

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    expect(text).toContain('@amplitude/analytics-browser');
    expect(text).toContain('init(');
    expect(response.usage.input_tokens).toBeGreaterThan(0);
    expect(response.usage.output_tokens).toBeGreaterThan(0);

    console.log(`  non-streaming: ${elapsed.toFixed(0)}ms`);
    console.log(
      `  tokens: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`,
    );
    console.log(`  auth: ${source}`);
  });

  it('streaming: generates Amplitude track() call', {
    timeout: 60_000,
  }, async () => {
    const start = performance.now();
    const client = createClient();

    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content:
            'Write a TypeScript snippet that imports track from @amplitude/analytics-browser ' +
            'and calls track("Button Clicked", { buttonId: "signup" }). Only output the code.',
        },
      ],
    });

    let firstTokenAt: number | undefined;
    let tokenCount = 0;

    stream.on('text', () => {
      tokenCount++;
      if (tokenCount === 1) firstTokenAt = performance.now();
    });

    const final = await stream.finalMessage();
    const elapsed = performance.now() - start;
    const ttft = firstTokenAt ? firstTokenAt - start : -1;

    const text = final.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    expect(text).toContain('track(');
    expect(text).toContain('@amplitude/analytics-browser');
    expect(final.usage.input_tokens).toBeGreaterThan(0);

    console.log(
      `  streaming: ${elapsed.toFixed(0)}ms (TTFT: ${ttft.toFixed(0)}ms, ${tokenCount} chunks)`,
    );
    console.log(
      `  tokens: ${final.usage.input_tokens} in / ${final.usage.output_tokens} out`,
    );
  });
});
