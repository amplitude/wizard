import { once } from 'events';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import { describe, expect, it, vi } from 'vitest';
import {
  wizardAgentSpawner,
  withWizardProcessIdentity,
} from '../wizard-agent-process';

function spawnProbe(
  code: string,
  stderr?: (data: string) => void,
  controller = new AbortController(),
) {
  return wizardAgentSpawner(stderr)({
    command: process.execPath,
    args: ['-e', code],
    cwd: process.cwd(),
    env: {
      ...process.env,
      WIZARD_PROBE: 'preserved',
      CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '0',
    },
    signal: controller.signal,
  }) as ChildProcessWithoutNullStreams;
}

describe('wizard agent process', () => {
  it('identifies the child as the wizard and preserves cwd, env, and piped protocol I/O', async () => {
    const child = spawnProbe(`process.stdin.on('data', data => {
      process.stdout.write(JSON.stringify({ argv0: process.argv0, cwd: process.cwd(),
        titleDisabled: process.env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE,
        inherited: process.env.WIZARD_PROBE, input: data.toString() }));
    });`);
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      output += chunk;
    });
    const closed = once(child, 'close');
    child.stdin.end('protocol message');
    expect(await closed).toEqual([0, null]);
    expect(JSON.parse(output)).toEqual({
      argv0: 'amplitude-wizard',
      cwd: process.cwd(),
      titleDisabled: '1',
      inherited: 'preserved',
      input: 'protocol message',
    });
  });

  it('forwards split UTF-8 stderr without corruption through the driver', async () => {
    const chunks: string[] = [];
    const stderr = (data: string) => {
      chunks.push(data);
    };
    const driver = vi.fn().mockReturnValue((async function* () {})());
    withWizardProcessIdentity(driver)({ prompt: 'hello', options: { stderr } });
    const spawn = driver.mock.calls[0][0].options
      .spawnClaudeCodeProcess as ReturnType<typeof wizardAgentSpawner>;
    const env = { ...process.env, CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '0' };
    const child = spawn({
      command: process.execPath,
      args: [
        '-e',
        `
      const bytes = Buffer.from('診断');
      process.stderr.write(bytes.subarray(0, 1));
      setTimeout(() => process.stderr.end(bytes.subarray(1)), 20);
    `,
      ],
      env,
      signal: new AbortController().signal,
    }) as ChildProcessWithoutNullStreams;
    expect(await once(child, 'close')).toEqual([0, null]);
    expect(chunks.join('')).toBe('診断');
    expect(env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE).toBe('0');
  });

  it('drains large stderr output when the caller has no stderr callback', async () => {
    const child = spawnProbe("process.stderr.write('x'.repeat(1024 * 1024));");
    expect(await once(child, 'close')).toEqual([0, null]);
  });

  it('honors the SDK abort signal and exposes process exit', async () => {
    const controller = new AbortController();
    const child = spawnProbe(
      "process.stdout.write('ready'); setInterval(() => {}, 1000);",
      undefined,
      controller,
    );
    const closed = new Promise((resolve) =>
      child.once('close', (code, signal) => resolve({ code, signal })),
    );
    const error = once(child, 'error');
    await once(child.stdout, 'data');
    controller.abort();
    expect((await error)[0]).toMatchObject({ code: 'ABORT_ERR' });
    expect(await closed).toEqual({ code: null, signal: 'SIGTERM' });
    expect(child.killed).toBe(true);
  });

  it('preserves a nonzero exit and its stderr diagnostic', async () => {
    const stderr = vi.fn();
    const child = spawnProbe(
      "process.stderr.write('failed to initialize'); process.exitCode = 7;",
      stderr,
    );
    expect(await once(child, 'close')).toEqual([7, null]);
    expect(stderr).toHaveBeenCalledWith('failed to initialize');
  });
});
