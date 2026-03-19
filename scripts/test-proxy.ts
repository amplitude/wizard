/**
 * Test script: validates the wizard proxy works end-to-end with real LLM calls.
 *
 * Prerequisites:
 *   1. Start the standalone proxy (javascript repo):
 *      cd javascript && ENVIRONMENT=local aws-vault exec us-prod-engineer -- \
 *        npx tsx server/packages/thunder/src/wizard-proxy-standalone.ts
 *
 *   2. Run this test:
 *      pnpm test:proxy
 *
 * Environment variables:
 *   WIZARD_PROXY_URL  — proxy base URL (default: http://localhost:3030/wizard)
 */

const PROXY_URL =
  process.env.WIZARD_PROXY_URL || 'http://127.0.0.1:3030/wizard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timer(): () => string {
  const start = performance.now();

  return () => `${(performance.now() - start).toFixed(0)}ms`;
}

interface ApiResponse {
  content?: Array<{ text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
  model?: string;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`\n🔍 Testing wizard proxy at ${PROXY_URL}\n`);

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
        headers: { 'x-api-key': 'dev-token' },
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

  // 3. Real LLM call — non-streaming: generate Amplitude Browser SDK init code
  {
    console.log(
      '3️⃣  POST /v1/messages (non-streaming) — Generate Amplitude SDK init code...',
    );
    const elapsed = timer();

    try {
      const res = await fetch(`${PROXY_URL}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': 'dev-token',
        },
        body: JSON.stringify({
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
        }),
      });

      const data = (await res.json()) as ApiResponse;

      if (!res.ok) {
        throw new Error(
          `status ${res.status}: ${JSON.stringify(data.error)}`,
        );
      }

      const text = data.content?.[0]?.text ?? '';
      const inputTokens = data.usage?.input_tokens ?? 0;
      const outputTokens = data.usage?.output_tokens ?? 0;

      // Validate the response contains expected code patterns
      const hasImport = text.includes('@amplitude/analytics-browser');
      const hasInit = text.includes('init(') || text.includes('init (');

      console.log(`   Response (${elapsed()}):`);
      console.log(`   ─────────────────────────────────────────`);

      for (const line of text.split('\n')) {
        console.log(`   ${line}`);
      }

      console.log(`   ─────────────────────────────────────────`);
      console.log(
        `   Tokens: ${inputTokens} in / ${outputTokens} out | Model: ${data.model}`,
      );
      console.log(
        `   ${hasImport ? '✅' : '❌'} Has @amplitude/analytics-browser import`,
      );
      console.log(`   ${hasInit ? '✅' : '❌'} Has init() call\n`);

      if (!hasImport || !hasInit) {
        console.warn(
          '   ⚠️  Response may not contain expected code — check output above',
        );
      }
    } catch (e: any) {
      console.error(
        `   ❌ Non-streaming failed (${elapsed()}): ${e.message}\n`,
      );
      process.exit(1);
    }
  }

  // 4. Streaming — ask for a slightly different snippet
  {
    console.log(
      '4️⃣  POST /v1/messages (streaming) — Generate Amplitude track() call...',
    );
    const elapsed = timer();

    try {
      const res = await fetch(`${PROXY_URL}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': 'dev-token',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 300,
          stream: true,
          messages: [
            {
              role: 'user',
              content:
                'Write a TypeScript snippet that imports track from @amplitude/analytics-browser ' +
                'and calls track("Button Clicked", { buttonId: "signup" }). Only output the code.',
            },
          ],
        }),
      });

      if (!res.ok) throw new Error(`status ${res.status}`);

      const reader = res.body?.getReader();

      if (!reader) throw new Error('No body reader');

      const decoder = new TextDecoder();
      const textChunks: string[] = [];
      let eventCount = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      const firstChunkTimer = timer();
      let timeToFirstChunk = '';

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;

          try {
            const evt = JSON.parse(line.slice(6));

            eventCount++;

            if (eventCount === 1) {
              timeToFirstChunk = firstChunkTimer();
            }

            if (evt.delta?.text) {
              textChunks.push(evt.delta.text);
            }

            // Extract usage from stream events
            if (evt.type === 'message_start' && evt.message?.usage) {
              inputTokens = evt.message.usage.input_tokens ?? 0;
            }

            if (evt.type === 'message_delta' && evt.usage) {
              outputTokens = evt.usage.output_tokens ?? 0;
            }
          } catch {
            // not JSON
          }
        }
      }

      const fullText = textChunks.join('');
      const hasTrack = fullText.includes('track(');
      const hasAmplitude = fullText.includes('@amplitude/analytics-browser');

      console.log(`   Response (${elapsed()}, first chunk: ${timeToFirstChunk}):`);
      console.log(`   ─────────────────────────────────────────`);

      for (const line of fullText.split('\n')) {
        console.log(`   ${line}`);
      }

      console.log(`   ─────────────────────────────────────────`);
      console.log(
        `   Events: ${eventCount} | Tokens: ${inputTokens} in / ${outputTokens} out`,
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
      // Set env vars the SDK expects
      process.env.ANTHROPIC_BASE_URL = PROXY_URL;
      process.env.ANTHROPIC_API_KEY = 'dev-token';

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

      const hasAmplitude = resultText.includes('@amplitude/analytics-browser');

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
