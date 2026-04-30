/**
 * In-process runner for the `apply_plan` MCP tool.
 *
 * Spawns `wizard apply --plan-id <id> --json` as a child of the
 * already-running MCP server, streams its NDJSON events to stderr (so
 * Claude Code sees real-time progress without polling a tail file), and
 * extracts the canonical `setup_complete` payload to return as the tool
 * result.
 *
 * The win vs the previous flow:
 *   - Outer agent (Claude Code) calls one MCP tool → no `npx` cold-start
 *     for THE wizard binary itself, just the inner apply child.
 *   - Progress visible immediately on stderr, no `sleep 30 && tail`.
 *   - Tool result is structured JSON, not "go grep stdout."
 *   - Apply lockfile + project-marker guards from the regular `apply`
 *     command apply unchanged — we deliberately reuse the existing
 *     binary entry instead of re-implementing the orchestration.
 *
 * Pure-ish: imports child_process + fs, no UI, so it can be exercised
 * by integration tests with a real plan file.
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';

/** Input to the apply runner. Mirrors the MCP tool input schema. */
export interface ApplyRunnerArgs {
  planId: string;
  installDir?: string;
  eventDecision: 'approved' | 'skipped' | 'revised';
  reviseFeedback?: string;
  appId?: string;
}

/**
 * Tool result shape. `ok: false` means the runner couldn't spawn or
 * parse output; `ok: true` always carries the child's exit code so the
 * caller can branch on success vs failure (apply with a non-zero
 * exit is still a "ran cleanly to error" result, not a runner failure).
 */
export type ApplyRunnerResult =
  | {
      ok: true;
      exitCode: number;
      /** Canonical setup_complete payload extracted from the NDJSON stream. */
      setupComplete: Record<string, unknown> | null;
      /** Last `error` event, if any — present on non-zero exit. */
      lastError?: { message: string; data?: unknown };
      /** Resolved final Amplitude scope (from setup_context apply_started). */
      amplitude?: Record<string, unknown>;
      /** Number of NDJSON events streamed. Useful for orchestrator metrics. */
      eventCount: number;
    }
  | {
      ok: false;
      error: string;
    };

/**
 * Run apply in-process, stream progress to stderr, return structured
 * result. The MCP tool calls this and forwards its JSON-serialized
 * result back to the orchestrator.
 *
 * @param wizardBin override path to the wizard binary entry. Production
 *   resolves from `process.argv[1]` (the same binary that's hosting
 *   this MCP server). Exposed for tests.
 */
export async function runApplyInProcess(
  args: ApplyRunnerArgs,
  wizardBin: string = process.argv[1] ?? '',
): Promise<ApplyRunnerResult> {
  if (!wizardBin) {
    return {
      ok: false,
      error: 'Could not resolve wizard binary path (process.argv[1] is empty).',
    };
  }
  const decisionFlag =
    args.eventDecision === 'approved'
      ? '--approve-events'
      : args.eventDecision === 'skipped'
      ? '--skip-events'
      : '--revise-events';
  const childArgs = [
    wizardBin,
    'apply',
    '--plan-id',
    args.planId,
    '--confirm-app',
    decisionFlag,
    '--yes',
    '--json',
  ];
  if (args.eventDecision === 'revised') {
    childArgs.push(args.reviseFeedback ?? '');
  }
  if (args.installDir) {
    childArgs.push('--install-dir', path.resolve(args.installDir));
  }
  if (args.appId) {
    childArgs.push('--app-id', args.appId);
  }

  return new Promise<ApplyRunnerResult>((resolve) => {
    const child = spawn(process.execPath, childArgs, {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: process.env,
    });

    let buffer = '';
    let setupComplete: Record<string, unknown> | null = null;
    let amplitude: Record<string, unknown> | undefined;
    let lastError: { message: string; data?: unknown } | undefined;
    let eventCount = 0;
    const stderrPrefix = '[wizard apply] ';

    child.stdout?.setEncoding('utf-8');
    child.stdout?.on('data', (chunk: string) => {
      // Forward each NDJSON line to stderr so the orchestrator sees
      // progress live (the MCP tool stdout is reserved for the protocol;
      // stderr is unbuffered and visible to the parent as a sibling
      // stream). We also accumulate to extract setup_complete.
      buffer += chunk;
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;
        eventCount += 1;
        // Best-effort: forward the raw line to stderr so a tailing
        // operator or curious orchestrator can see exactly what the
        // wizard emitted. The MCP SDK's stderr is the normal stderr
        // stream — it's NOT part of the JSON-RPC protocol channel.
        process.stderr.write(stderrPrefix + line + '\n');
        try {
          const parsed = JSON.parse(line) as {
            type?: string;
            message?: string;
            data?: Record<string, unknown>;
          };
          const data = parsed.data;
          const eventName =
            data && typeof data.event === 'string' ? data.event : undefined;
          if (eventName === 'setup_complete' && data) {
            setupComplete = data;
            const amp = data.amplitude;
            if (amp && typeof amp === 'object') {
              amplitude = amp as Record<string, unknown>;
            }
          } else if (eventName === 'setup_context' && data) {
            // The `apply_started` setup_context carries the more
            // authoritative scope (post env-selection). Track the
            // most recent one so we have something to report even
            // if setup_complete never arrives (apply crashed).
            const phase =
              typeof data.phase === 'string' ? data.phase : undefined;
            if (phase === 'apply_started') {
              const amp = data.amplitude;
              if (amp && typeof amp === 'object') {
                amplitude = amp as Record<string, unknown>;
              }
            }
          } else if (parsed.type === 'error') {
            lastError = {
              message: parsed.message ?? 'unknown error',
              data,
            };
          }
        } catch {
          // Non-JSON line (shouldn't happen in --json mode, but be tolerant).
        }
      }
    });

    child.on('error', (err) => {
      resolve({
        ok: false,
        error: `Failed to spawn wizard apply: ${err.message}`,
      });
    });

    child.on('exit', (code) => {
      // Drain any remaining buffer (last line may not have ended with \n).
      if (buffer.trim().length > 0) {
        eventCount += 1;
        process.stderr.write(stderrPrefix + buffer.trim() + '\n');
      }
      resolve({
        ok: true,
        exitCode: code ?? -1,
        setupComplete,
        ...(amplitude ? { amplitude } : {}),
        ...(lastError ? { lastError } : {}),
        eventCount,
      });
    });
  });
}

/**
 * Run `wizard reset` in-process. Same pattern as the apply runner —
 * spawn the binary's existing `reset` subcommand and return its result.
 */
export async function runResetInProcess(
  installDir: string,
  wizardBin: string = process.argv[1] ?? '',
): Promise<
  | {
      ok: true;
      exitCode: number;
      removed: string[];
      skipped: string[];
    }
  | { ok: false; error: string }
> {
  if (!wizardBin) {
    return {
      ok: false,
      error: 'Could not resolve wizard binary path (process.argv[1] is empty).',
    };
  }
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [wizardBin, 'reset', '--install-dir', path.resolve(installDir), '--json'],
      { stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
    );
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf-8');
    child.stderr?.setEncoding('utf-8');
    child.stdout?.on('data', (c: string) => (stdout += c));
    child.stderr?.on('data', (c: string) => (stderr += c));
    child.on('error', (err) => {
      resolve({
        ok: false,
        error: `Failed to spawn wizard reset: ${err.message}`,
      });
    });
    child.on('exit', (code) => {
      // Find the reset event line in the JSON output.
      const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
      let removed: string[] = [];
      let skipped: string[] = [];
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as {
            data?: { event?: string; removed?: unknown; skipped?: unknown };
          };
          if (parsed.data?.event === 'reset') {
            if (Array.isArray(parsed.data.removed)) {
              removed = parsed.data.removed.filter(
                (x): x is string => typeof x === 'string',
              );
            }
            if (Array.isArray(parsed.data.skipped)) {
              skipped = parsed.data.skipped.filter(
                (x): x is string => typeof x === 'string',
              );
            }
          }
        } catch {
          /* tolerant */
        }
      }
      if (code !== 0 && stderr) {
        process.stderr.write(`[wizard reset stderr] ${stderr.trim()}\n`);
      }
      resolve({
        ok: true,
        exitCode: code ?? -1,
        removed,
        skipped,
      });
    });
  });
}
