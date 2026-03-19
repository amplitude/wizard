/**
 * Test script: validates the wizard proxy works end-to-end with real LLM calls.
 *
 * Uses the Anthropic SDK directly — same client the Claude Agent SDK uses under
 * the hood — so streaming, SSE parsing, and error handling are all battle-tested.
 *
 * Auth: Reads the OAuth access token from ~/.ampli.json (stored by `pnpm try login`).
 * Falls back to 'dev-token' for local dev when the proxy has auth bypass enabled.
 *
 * Prerequisites:
 *   1. Login: pnpm try login
 *   2. Start the proxy: pnpm proxy (or pnpm proxy:bypass to skip auth)
 *   3. Run this test: pnpm test:proxy
 *
 * Environment variables:
 *   WIZARD_PROXY_URL  — proxy base URL (default: http://localhost:3030/wizard)
 *   WIZARD_PROXY_TEST_TOKEN — explicit token override (skips ~/.ampli.json lookup)
 */

import Anthropic from '@anthropic-ai/sdk';

import { getStoredToken, getStoredUser } from '../src/utils/ampli-settings';

const PROXY_URL =
  process.env.WIZARD_PROXY_URL || 'http://127.0.0.1:3030/wizard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timer(): () => string {
  const start = performance.now();

  return () => `${(performance.now() - start).toFixed(0)}ms`;
}

/**
 * Resolve the auth token to use for proxy requests.
 * Priority: env var override > stored OAuth token > fallback dev-token
 */
function resolveAuthToken(): { token: string; source: string } {
  // 1. Explicit override
  const envToken = process.env.WIZARD_PROXY_TEST_TOKEN;

  if (envToken) {
    return { token: envToken, source: 'WIZARD_PROXY_TEST_TOKEN env var' };
  }

  // 2. Stored OAuth token from `pnpm try login`
  const storedUser = getStoredUser();
  const storedToken = getStoredToken(storedUser?.id, storedUser?.zone);

  if (storedToken?.accessToken) {
    const email = storedUser?.email ?? 'unknown';

    return {
      token: storedToken.accessToken,
      source: `~/.ampli.json (${email})`,
    };
  }

  // 3. Fallback for local dev with auth bypass
  return { token: 'dev-token', source: 'fallback dev-token (no login found)' };
}

function createClient(apiKey: string): Anthropic {
  return new Anthropic({
    apiKey,
    baseURL: PROXY_URL,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { token, source } = resolveAuthToken();

  console.log(`\n🔍 Testing wizard proxy at ${PROXY_URL}`);
  console.log(`🔑 Auth: ${source}\n`);

  // 1. Health check
  {
    console.log('1️⃣  Health check...');
    const elapsed = timer();

    try {
      const res = await fetch(`${PROXY_URL}/health`);

      if (!res.ok) throw new Error(`status ${res.status}`);
      console.log(`   ✅ Health check passed (${elapsed()})\n`);
    } catch (e: any) {
      console.error(`   ❌ Health check failed (${elapsed()}): ${e.message}`);
      console.error(
        '   Make sure the proxy is running:\n' +
          '     cd javascript && ENVIRONMENT=local aws-vault exec us-prod-engineer -- \\\n' +
          '       npx tsx server/packages/thunder/src/wizard-proxy-standalone.ts',
      );
      process.exit(1);
    }
  }

  // 2. Models endpoint
  {
    console.log('2️⃣  GET /v1/models...');
    const elapsed = timer();

    try {
      const res = await fetch(`${PROXY_URL}/v1/models`, {
        headers: { 'x-api-key': token },
      });
      const models = (await res.json()) as {
        data: Array<{ id: string }>;
      };

      console.log(
        `   ✅ Models: ${models.data.map((m) => m.id).join(', ')} (${elapsed()})\n`,
      );
    } catch (e: any) {
      console.error(`   ❌ Models failed (${elapsed()}): ${e.message}\n`);
    }
  }

  // 3. Non-streaming — generate Amplitude Browser SDK init code
  {
    console.log(
      '3️⃣  POST /v1/messages (non-streaming) — Generate Amplitude SDK init code...',
    );
    const elapsed = timer();
    const client = createClient(token);

    try {
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

      const text =
        response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('') || '';

      const hasImport = text.includes('@amplitude/analytics-browser');
      const hasInit = text.includes('init(');

      console.log(`   Response (${elapsed()}):`);
      console.log(`   ─────────────────────────────────────────`);

      for (const line of text.split('\n')) {
        console.log(`   ${line}`);
      }

      console.log(`   ─────────────────────────────────────────`);
      console.log(
        `   Tokens: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out | Model: ${response.model}`,
      );
      console.log(
        `   ${hasImport ? '✅' : '❌'} Has @amplitude/analytics-browser import`,
      );
      console.log(`   ${hasInit ? '✅' : '❌'} Has init() call\n`);
    } catch (e: any) {
      console.error(
        `   ❌ Non-streaming failed (${elapsed()}): ${e.message}\n`,
      );
      process.exit(1);
    }
  }

  // 4. Streaming — generate Amplitude track() call
  {
    console.log(
      '4️⃣  POST /v1/messages (streaming) — Generate Amplitude track() call...',
    );
    const elapsed = timer();
    const client = createClient(token);

    try {
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

      let timeToFirstToken = '';
      let tokenCount = 0;

      stream.on('text', () => {
        tokenCount++;

        if (tokenCount === 1) {
          timeToFirstToken = elapsed();
        }
      });

      const finalMessage = await stream.finalMessage();

      const text =
        finalMessage.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('') || '';

      const hasTrack = text.includes('track(');
      const hasAmplitude = text.includes('@amplitude/analytics-browser');

      console.log(
        `   Response (${elapsed()}, first token: ${timeToFirstToken}):`,
      );
      console.log(`   ─────────────────────────────────────────`);

      for (const line of text.split('\n')) {
        console.log(`   ${line}`);
      }

      console.log(`   ─────────────────────────────────────────`);
      console.log(
        `   Tokens: ${finalMessage.usage.input_tokens} in / ${finalMessage.usage.output_tokens} out`,
      );
      console.log(`   ${hasAmplitude ? '✅' : '❌'} Has amplitude import`);
      console.log(`   ${hasTrack ? '✅' : '❌'} Has track() call\n`);
    } catch (e: any) {
      console.error(`   ❌ Streaming failed (${elapsed()}): ${e.message}\n`);
      process.exit(1);
    }
  }

  // 5. Claude Agent SDK integration
  {
    console.log('5️⃣  Claude Agent SDK integration...');
    const elapsed = timer();

    try {
      process.env.ANTHROPIC_BASE_URL = PROXY_URL;
      process.env.ANTHROPIC_API_KEY = token;

      const { query } = await import('@anthropic-ai/claude-agent-sdk');

      let resultText = '';
      let resultType = '';

      const response = query({
        prompt: (async function* () {
          yield {
            type: 'user' as const,
            session_id: '',
            message: {
              role: 'user' as const,
              content:
                'Write a one-line TypeScript import for @amplitude/analytics-browser. Only output the code.',
            },
            parent_tool_use_id: null,
          };
        })(),
        options: {
          model: 'anthropic/claude-sonnet-4-6',
          cwd: process.cwd(),
          permissionMode: 'acceptEdits',
          maxTurns: 1,
          allowedTools: [],
        },
      });

      for await (const msg of response) {
        if (msg.type === 'assistant') {
          const content = (msg as any).message?.content;

          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text') resultText += block.text;
            }
          }
        }

        if (msg.type === 'result') {
          resultType = `${(msg as any).subtype} (is_error: ${(msg as any).is_error})`;
          break;
        }
      }

      const hasAmplitude = resultText.includes(
        '@amplitude/analytics-browser',
      );

      console.log(`   Response (${elapsed()}):`);
      console.log(`   ─────────────────────────────────────────`);
      console.log(`   ${resultText}`);
      console.log(`   ─────────────────────────────────────────`);
      console.log(`   Result: ${resultType}`);
      console.log(
        `   ${hasAmplitude ? '✅' : '⚠️ '} ${hasAmplitude ? 'Has amplitude import' : 'Expected amplitude import — check output above'}\n`,
      );
    } catch (e: any) {
      console.error(`   ❌ SDK test failed (${elapsed()}): ${e.message}\n`);
      // Don't exit — SDK test is best-effort since it spawns claude CLI
    }
  }

  console.log('✅ Proxy validation complete!\n');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
