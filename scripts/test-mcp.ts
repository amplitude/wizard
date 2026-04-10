/**
 * Quick test script for the MCP event detection flow.
 * Run with: pnpm tsx scripts/test-mcp.ts [projectId]
 *
 * Reads stored OAuth token from ~/.ampli.json automatically.
 * Override with: MCP_ACCESS_TOKEN=<token> pnpm tsx scripts/test-mcp.ts <projectId>
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const PROJECT_ID = process.argv[2] ?? '804053';
const MCP_URL = process.env.MCP_URL ?? 'https://mcp.amplitude.com/mcp';

function getStoredAccessToken(): string | null {
  try {
    const config = JSON.parse(
      readFileSync(join(homedir(), '.ampli.json'), 'utf-8'),
    ) as Record<string, unknown>;
    for (const [key, value] of Object.entries(config)) {
      if (!key.startsWith('User-') && !key.startsWith('User[')) continue;
      const entry = value as Record<string, string>;
      if (entry.OAuthAccessToken) {
        const expiresAt = new Date(entry.OAuthExpiresAt ?? 0);
        const refreshExpiry = new Date(
          expiresAt.getTime() + 364 * 24 * 60 * 60 * 1000,
        );
        if (new Date() > refreshExpiry) {
          console.log(`  [skip] ${key}: token expired`);
          continue;
        }
        console.log(`  [use]  ${key}: expires ${entry.OAuthExpiresAt}`);
        return entry.OAuthAccessToken;
      }
    }
    return null;
  } catch (e) {
    console.error('Failed to read ~/.ampli.json:', e);
    return null;
  }
}

async function testMcp(accessToken: string): Promise<void> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'amplitude-wizard-test/1.0',
  };

  console.log(`\n── Step 1: initialize (${MCP_URL}) ──`);
  const initRes = await fetch(MCP_URL, {
    method: 'POST',
    headers: { ...headers, Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'amplitude-wizard-test', version: '1.0.0' },
      },
    }),
  });

  console.log(`  status: ${initRes.status}`);
  console.log(`  headers: ${[...initRes.headers.keys()].join(', ')}`);
  const sessionId = initRes.headers.get('mcp-session-id');
  console.log(`  Mcp-Session-Id: ${sessionId ?? '(none)'}`);

  const initBody = await initRes.text();
  console.log(`  body (first 300): ${initBody.slice(0, 300)}`);

  if (!sessionId) {
    console.log('\n✗ No session ID — cannot proceed to tools/call');
    return;
  }

  console.log(`\n── Step 2: notifications/initialized ──`);
  const notifRes = await fetch(MCP_URL, {
    method: 'POST',
    headers: { ...headers, 'Mcp-Session-Id': sessionId },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }),
  });
  console.log(`  status: ${notifRes.status}`);
  await notifRes.body?.cancel().catch(() => undefined);

  let _id = 10;
  const nextId = () => ++_id;

  const tryQuery = async (label: string, eventType: string | null) => {
    const events = eventType
      ? [{ event_type: eventType, filters: [], group_by: [] }]
      : [];
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        ...headers,
        'Mcp-Session-Id': sessionId!,
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: nextId(),
        method: 'tools/call',
        params: {
          name: 'query_dataset',
          arguments: {
            projectId: PROJECT_ID,
            definition: {
              app: PROJECT_ID,
              type: 'eventsSegmentation',
              params: {
                range: 'Last 7 Days',
                events,
                metric: 'totals',
                countGroup: 'User',
                segments: [{ conditions: [] }],
              },
            },
          },
        },
      }),
    });
    const body = await res.text();
    const inner = body.match(/"text":"(.{0,300})"/)?.[1] ?? body.slice(0, 300);
    const success =
      inner.includes('"success":true') ||
      (!inner.includes('"success":false') && !inner.includes('isError'));
    console.log(`  ${success ? '✓' : '✗'} ${label}: ${inner.slice(0, 200)}`);
  };

  console.log('\n── Event type probes ──');
  await tryQuery('Any Active Event', '[Amplitude] Any Active Event');
  await tryQuery('Any Event', '[Amplitude] Any Event');
  await tryQuery('_all (no brackets)', '_all');
  // Print full _all response
  const allRes = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      ...headers,
      'Mcp-Session-Id': sessionId!,
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: nextId(),
      method: 'tools/call',
      params: {
        name: 'query_dataset',
        arguments: {
          projectId: PROJECT_ID,
          definition: {
            app: PROJECT_ID,
            type: 'eventsSegmentation',
            params: {
              range: 'Last 7 Days',
              events: [{ event_type: '_all', filters: [], group_by: [] }],
              metric: 'totals',
              countGroup: 'User',
              segments: [{ conditions: [] }],
            },
          },
        },
      },
    }),
  });
  const allBody = await allRes.text();
  const allData = allBody.match(/^data: (.+)$/m)?.[1] ?? '';
  let allParsed: Record<string, unknown> = {};
  try {
    allParsed = JSON.parse(allData) as Record<string, unknown>;
  } catch {}
  const textContent =
    (
      (allParsed.result as Record<string, unknown>)?.content as
        | Array<{ text: string }>
        | undefined
    )?.[0]?.text ?? '';
  try {
    const inner = JSON.parse(textContent) as Record<string, unknown>;
    console.log(
      '  Full _all result:',
      JSON.stringify(inner.data, null, 2).slice(0, 600),
    );
  } catch {
    console.log('  Raw text:', textContent.slice(0, 400));
  }
  await tryQuery('empty events array', null);

  console.log(`\n── Step 2b: tools/list ──`);
  const listRes = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      ...headers,
      'Mcp-Session-Id': sessionId,
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: nextId(),
      method: 'tools/list',
    }),
  });
  const listBody = await listRes.text();
  // Extract SSE data
  const listData = listBody.match(/^data: (.+)$/m)?.[1] ?? '';
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(listData) as Record<string, unknown>;
  } catch {}
  const tools =
    ((parsed.result as Record<string, unknown>)?.tools as
      | Array<{ name: string; description?: string; inputSchema?: unknown }>
      | undefined) ?? [];
  console.log(`  available tools: ${tools.map((t) => t.name).join(', ')}`);
  // Print each tool's schema
  for (const tool of tools) {
    console.log(
      `\n  [tool] ${tool.name}: ${tool.description ?? '(no description)'}`,
    );
    console.log(
      `    schema: ${JSON.stringify(tool.inputSchema, null, 2).slice(0, 600)}`,
    );
  }

  console.log('\n── list_events probe (full response) ──');
  const eventsRes = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      ...headers,
      'Mcp-Session-Id': sessionId,
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: nextId(),
      method: 'tools/call',
      params: { name: 'list_events', arguments: { projectId: PROJECT_ID } },
    }),
  });
  const eventsBody = await eventsRes.text();
  const eventsData = eventsBody.match(/^data: (.+)$/m)?.[1] ?? eventsBody;
  let eventsParsed: Record<string, unknown> = {};
  try {
    eventsParsed = JSON.parse(eventsData) as Record<string, unknown>;
  } catch {}
  const eventsText =
    (
      (eventsParsed.result as Record<string, unknown>)?.content as
        | Array<{ text?: string }>
        | undefined
    )?.[0]?.text ?? eventsData;
  console.log(`  list_events text (first 1000): ${eventsText.slice(0, 1000)}`);

  const probe = async (label: string, toolName: string, args: unknown) => {
    console.log(`\n── ${label} ──`);
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        ...headers,
        'Mcp-Session-Id': sessionId!,
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: nextId(),
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
    });
    const body = await res.text();
    const data = body.match(/^data: (.+)$/m)?.[1] ?? body;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(data) as Record<string, unknown>;
    } catch {}
    const text =
      (
        (parsed.result as Record<string, unknown>)?.content as
          | Array<{ text?: string }>
          | undefined
      )?.[0]?.text ?? data;
    console.log(`  result (first 2000): ${text.slice(0, 2000)}`);
  };

  await probe('list_session_replays', 'list_session_replays', {
    projectId: PROJECT_ID,
    limit: 5,
  });
  await probe('get_session_replays', 'get_session_replays', {
    projectId: PROJECT_ID,
  });
  await probe('get_users (_active)', 'get_users', {
    projectId: PROJECT_ID,
    event: { event_type: '_active', filters: [] },
    limit: 5,
  });
  await probe('get_users (_all)', 'get_users', {
    projectId: PROJECT_ID,
    event: { event_type: '_all', filters: [] },
    limit: 5,
  });

  console.log('\n── get_events probe ──');
  const getEventsRes = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      ...headers,
      'Mcp-Session-Id': sessionId!,
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: nextId(),
      method: 'tools/call',
      params: {
        name: 'get_events',
        arguments: { projectId: PROJECT_ID, limit: 20 },
      },
    }),
  });
  const getEventsBody = await getEventsRes.text();
  const getEventsData =
    getEventsBody.match(/^data: (.+)$/m)?.[1] ?? getEventsBody;
  let getEventsParsed: Record<string, unknown> = {};
  try {
    getEventsParsed = JSON.parse(getEventsData) as Record<string, unknown>;
  } catch {}
  const getEventsText =
    (
      (getEventsParsed.result as Record<string, unknown>)?.content as
        | Array<{ text?: string }>
        | undefined
    )?.[0]?.text ?? getEventsData;
  console.log(`  get_events (first 2000): ${getEventsText.slice(0, 2000)}`);

  // Test valid date ranges for query_dataset
  for (const range of [
    'Last 7 Days',
    'Last 30 Days',
    'Today',
    'yesterday',
    'Last 24 Hours',
    'last 1 days',
  ]) {
    const r = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        ...headers,
        'Mcp-Session-Id': sessionId!,
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: nextId(),
        method: 'tools/call',
        params: {
          name: 'query_dataset',
          arguments: {
            projectId: PROJECT_ID,
            definition: {
              app: PROJECT_ID,
              type: 'eventsSegmentation',
              params: {
                range,
                events: [{ event_type: '_all', filters: [], group_by: [] }],
                metric: 'totals',
                countGroup: 'User',
                segments: [{ conditions: [] }],
              },
            },
          },
        },
      }),
    });
    const rb = await r.text();
    const rd = rb.match(/^data: (.+)$/m)?.[1] ?? '';
    let rp: Record<string, unknown> = {};
    try {
      rp = JSON.parse(rd) as Record<string, unknown>;
    } catch {}
    const rt =
      (
        (rp.result as Record<string, unknown>)?.content as
          | Array<{ text?: string }>
          | undefined
      )?.[0]?.text ?? '';
    let ri: Record<string, unknown> = {};
    try {
      ri = JSON.parse(rt) as Record<string, unknown>;
    } catch {}
    console.log(
      `  range "${range}": success=${
        (ri as { success?: boolean }).success ?? 'parse-err'
      }, data=${JSON.stringify((ri as { data?: unknown }).data).slice(0, 100)}`,
    );
  }

  console.log(
    `\n── Step 3: tools/call query_dataset (projectId=${PROJECT_ID}) ──`,
  );
  const toolRes = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      ...headers,
      'Mcp-Session-Id': sessionId,
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'query_dataset',
        arguments: {
          projectId: PROJECT_ID,
          definition: {
            app: PROJECT_ID,
            type: 'eventsSegmentation',
            params: {
              range: 'Last 7 Days',
              events: [
                {
                  event_type: '[Amplitude] Any Active Event',
                  filters: [],
                  group_by: [],
                },
              ],
              metric: 'totals',
              countGroup: 'User',
              segments: [{ conditions: [] }],
            },
          },
        },
      },
    }),
  });

  console.log(`  status: ${toolRes.status}`);
  const toolBody = await toolRes.text();
  console.log(`  body (first 800): ${toolBody.slice(0, 800)}`);
}

async function main() {
  const accessToken = process.env.MCP_ACCESS_TOKEN ?? getStoredAccessToken();
  if (!accessToken) {
    console.error(
      'No access token found. Run the wizard once to log in, or set MCP_ACCESS_TOKEN.',
    );
    process.exit(1);
  }
  console.log(`Access token: ${accessToken.slice(0, 20)}...`);
  console.log(`Project ID: ${PROJECT_ID}`);
  await testMcp(accessToken);
}

main().catch(console.error);
