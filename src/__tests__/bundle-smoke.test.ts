/**
 * Bundle smoke tests — exercise the published `dist/bin.js` artifact end-to-end.
 *
 * These tests guard the contract that our build still produces a usable CLI
 * after the tsup bundle migration:
 *   • `--version` exits 0 with the version string
 *   • `status --json` emits a parseable JSON envelope
 *   • `mcp serve` initializes and responds to `tools/list`
 *
 * They are deliberately spawn-based (real `node`) instead of in-process
 * imports so they catch issues that only surface in the bundled artifact —
 * shebang corruption, externals not resolving from the consumer's
 * node_modules, accidental top-level awaits in a CJS bundle, etc.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..');
const BIN = join(REPO_ROOT, 'dist', 'bin.js');

// A previous green `pnpm build` is required for these to run. CI always
// builds before tests; locally, contributors should `pnpm build` first.
const SKIP_REASON = existsSync(BIN)
  ? null
  : 'dist/bin.js missing — run `pnpm build` first';

describe.skipIf(SKIP_REASON !== null)('bundled bin smoke', () => {
  beforeAll(() => {
    expect(existsSync(BIN)).toBe(true);
  });

  test('node dist/bin.js --version exits 0 with the version string', () => {
    const result = spawnSync('node', [BIN, '--version'], {
      timeout: 30_000,
      env: { ...process.env, NO_COLOR: '1' },
    });
    expect(result.status).toBe(0);
    // The version is sourced from package.json at build time; just assert
    // semver-ish shape so we don't have to bump this test on every release.
    expect(result.stdout.toString().trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('node dist/bin.js status --json emits a parseable JSON envelope', () => {
    // Run `status --json` against a brand-new temp dir so no real project
    // metadata is read. The output is the wizard's read-only project status
    // shape (frame, sdk, apiKey, auth) — not the orchestration `v: 1`
    // envelope, which `apply` / `verify` emit. Both are valid JSON shapes
    // we want to keep passing the bundle's bytes.
    const installDir = mkdtempSync(join(tmpdir(), 'wizard-bundle-status-'));
    const result = spawnSync(
      'node',
      [BIN, 'status', '--json', '--install-dir', installDir],
      {
        timeout: 30_000,
        env: {
          ...process.env,
          NO_COLOR: '1',
          AMPLITUDE_WIZARD_SKIP_BOOTSTRAP: '1',
        },
      },
    );
    expect(result.status).toBe(0);
    const stdout = result.stdout.toString();
    // Last newline-terminated chunk is the JSON; deprecation warnings (if
    // any) land on stderr.
    const json = JSON.parse(stdout.trim());
    expect(json).toHaveProperty('installDir', installDir);
    expect(json).toHaveProperty('framework');
    expect(json).toHaveProperty('amplitudeInstalled');
    expect(json).toHaveProperty('apiKey');
    expect(json).toHaveProperty('auth');
  });

  test('node dist/bin.js mcp serve initializes and responds to tools/list', async () => {
    const child = spawn('node', [BIN, 'mcp', 'serve'], {
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks: string[] = [];
    child.stdout.on('data', (chunk: Buffer) =>
      stdoutChunks.push(chunk.toString()),
    );
    // Don't accumulate stderr — server logs warnings about deprecations etc.

    // Send `initialize` first (per MCP handshake), then `tools/list`.
    const initialize = {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'wizard-bundle-smoke', version: '0' },
      },
      id: 1,
    };
    const listTools = {
      jsonrpc: '2.0',
      method: 'tools/list',
      params: {},
      id: 2,
    };
    child.stdin.write(JSON.stringify(initialize) + '\n');
    // Small delay so the server processes the initialize before we ask for
    // the tool list — the JSON-RPC framer is line-delimited but the server
    // does its own dispatch tick.
    await new Promise((r) => setTimeout(r, 100));
    child.stdin.write(JSON.stringify(listTools) + '\n');

    // Wait up to 5s for the tools/list response to land.
    const deadline = Date.now() + 5_000;
    let toolsResponse: { result?: { tools?: Array<{ name: string }> } } | null =
      null;
    while (Date.now() < deadline && toolsResponse === null) {
      await new Promise((r) => setTimeout(r, 50));
      const buffer = stdoutChunks.join('');
      // Each JSON-RPC response is its own line — find the one with id: 2.
      for (const line of buffer.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.id === 2 && parsed.result) {
            toolsResponse = parsed;
            break;
          }
        } catch {
          // Partial line — ignore until next chunk.
        }
      }
    }

    child.stdin.end();
    child.kill();

    expect(toolsResponse).not.toBeNull();
    const tools = toolsResponse?.result?.tools ?? [];
    // Read-only tools the external MCP server exposes (see
    // src/lib/wizard-mcp-server.ts). Bundle must surface them.
    const names = tools.map((t) => t.name);
    expect(names).toContain('detect_framework');
    expect(names).toContain('get_project_status');
    expect(names).toContain('get_auth_status');
  });
});
