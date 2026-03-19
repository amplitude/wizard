/**
 * Test script: validates the wizard proxy works with the Claude Agent SDK.
 *
 * Prerequisites:
 *   1. Start Thunder locally (javascript repo):
 *      cd javascript && WIZARD_PROXY_DEV_BYPASS=1 \
 *        aws-vault exec us-prod-engineer -- pnpm --filter thunder start:local
 *
 *   2. Run this test:
 *      pnpm test:proxy
 *
 * Environment variables:
 *   WIZARD_PROXY_URL  — proxy base URL (default: http://localhost:3030/wizard)
 */

const PROXY_URL =
  process.env.WIZARD_PROXY_URL || 'http://127.0.0.1:3030/wizard';

async function main() {
  console.log(`\n🔍 Testing wizard proxy at ${PROXY_URL}\n`);

  // 1. Health check
  console.log('1️⃣  Health check...');
  try {
    const healthRes = await fetch(`${PROXY_URL}/health`);
    if (!healthRes.ok) throw new Error(`status ${healthRes.status}`);
    console.log('   ✅ Health check passed\n');
  } catch (e: any) {
    console.error(`   ❌ Health check failed: ${e.message}`);
    console.error(
      '   Make sure Thunder is running: cd javascript && WIZARD_PROXY_DEV_BYPASS=1 aws-vault exec us-prod-engineer -- pnpm --filter thunder start',
    );
    process.exit(1);
  }

  // 2. Models endpoint
  console.log('2️⃣  GET /v1/models...');
  try {
    const modelsRes = await fetch(`${PROXY_URL}/v1/models`, {
      headers: { 'x-api-key': 'dev-token' },
    });
    const models = (await modelsRes.json()) as {
      data: Array<{ id: string }>;
    };
    console.log(
      `   ✅ Models: ${models.data.map((m: { id: string }) => m.id).join(', ')}\n`,
    );
  } catch (e: any) {
    console.error(`   ❌ Models failed: ${e.message}\n`);
  }

  // 3. Non-streaming /v1/messages
  console.log('3️⃣  POST /v1/messages (non-streaming)...');
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
        max_tokens: 50,
        messages: [
          { role: 'user', content: 'Say exactly: PROXY_TEST_OK' },
        ],
      }),
    });
    const data = (await res.json()) as {
      content?: Array<{ text?: string }>;
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(
        `status ${res.status}: ${JSON.stringify(data.error)}`,
      );
    }
    const text = data.content?.[0]?.text ?? '';
    console.log(`   ✅ Claude says: "${text}"\n`);
  } catch (e: any) {
    console.error(`   ❌ Non-streaming failed: ${e.message}\n`);
    process.exit(1);
  }

  // 4. Streaming /v1/messages
  console.log('4️⃣  POST /v1/messages (streaming)...');
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
        max_tokens: 50,
        stream: true,
        messages: [
          { role: 'user', content: 'Say exactly: STREAM_TEST_OK' },
        ],
      }),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No body reader');

    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let eventCount = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      // Extract text deltas from SSE
      for (const line of text.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.delta?.text) chunks.push(evt.delta.text);
            eventCount++;
          } catch {
            // not JSON
          }
        }
      }
    }

    const fullText = chunks.join('');
    console.log(
      `   ✅ Streamed ${eventCount} events, text: "${fullText}"\n`,
    );
  } catch (e: any) {
    console.error(`   ❌ Streaming failed: ${e.message}\n`);
    process.exit(1);
  }

  // 5. Claude Agent SDK integration
  console.log('5️⃣  Claude Agent SDK integration...');
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
          type: 'user',
          session_id: '',
          message: {
            role: 'user',
            content: 'Say exactly: SDK_TEST_OK',
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

    if (resultText.includes('SDK_TEST_OK')) {
      console.log(`   ✅ SDK result: "${resultText}" [${resultType}]\n`);
    } else {
      console.log(
        `   ⚠️  SDK returned: "${resultText}" [${resultType}] (expected SDK_TEST_OK)\n`,
      );
    }
  } catch (e: any) {
    console.error(`   ❌ SDK test failed: ${e.message}\n`);
    // Don't exit — SDK test is best-effort since it spawns claude CLI
  }

  console.log('✅ Proxy validation complete!\n');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
