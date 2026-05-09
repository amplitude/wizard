/**
 * Shared option-resolution and JSON-output helpers for the orchestration
 * surface (`wizard orchestration`, `wizard tasks`, `wizard sessions`,
 * `wizard choice`, `wizard verification`, `wizard resume`).
 *
 * All consumers must use `resolveCommonOpts` here rather than rolling
 * their own inline `argv.installDir ?? process.cwd()` — that shorthand
 * skips `resolveInstallDir`, which silently breaks tilde expansion (a
 * user passing `--install-dir ~/myapp` ends up with a literal
 * `<cwd>/~/myapp`).
 */

export interface CommonOpts {
  installDir: string;
  jsonOutput: boolean;
}

export async function resolveCommonOpts(argv: {
  installDir?: string;
  json?: boolean;
  human?: boolean;
}): Promise<CommonOpts> {
  // Run user-provided `--install-dir` through `resolveInstallDir` so a
  // quoted / env-sourced `~` actually expands to the home directory —
  // otherwise the orchestration store is looked up under
  // `<cwd>/~/myapp` instead of `<home>/myapp`.
  const { resolveInstallDir } = await import('../utils/install-dir.js');
  const installDir = resolveInstallDir(argv.installDir);
  const { resolveMode } = await import('../lib/mode-config.js');
  const { jsonOutput } = resolveMode({
    json: argv.json,
    human: argv.human,
    isTTY: Boolean(process.stdout.isTTY),
  });
  return { installDir, jsonOutput };
}

export function emitJson(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload) + '\n');
}

export function emitJsonError(message: string, code?: string): void {
  const payload: Record<string, unknown> = {
    v: 1,
    type: 'error',
    '@timestamp': new Date().toISOString(),
    message,
  };
  if (code !== undefined) payload.code = code;
  emitJson(payload);
}
