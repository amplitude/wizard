/**
 * Tool surface for the AI-SDK inner-loop runner (Phase D-3).
 *
 * D-3 ships the *foundation*: a minimal native AI-SDK tool set wrapping
 * a subset of the in-process `wizard-tools` MCP schemas, sufficient to
 * exercise the runner end-to-end on a basic JS/Web fixture. Full MCP
 * bridging — wrapping the existing `createWizardToolsServer` and the
 * remote `amplitude-wizard` MCP via `experimental_createMCPClient` — is
 * Phase D-4.
 *
 * Per migration plan §11 risk register, the bridge sits behind an
 * internal interface so the v6 → v7 SDK rename of
 * `experimental_createMCPClient` (when it lands) is a single-file
 * diff, not a 50-file refactor.
 */
import path from 'path';
import * as fs from 'fs';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';

import { logToFile } from '../../utils/debug.js';
import {
  emitFileChangeApplied,
  emitFileChangePlanned,
} from './run-agent-events.js';

/**
 * Inputs the runner needs to assemble its tool surface. Threads through
 * the same plumbing the legacy `createWizardToolsServer` consumes, so
 * D-4 (which swaps the body of {@link buildAiSdkAgentTools} for a
 * proper MCP bridge) doesn't change this signature.
 */
export interface AiSdkAgentToolsOptions {
  /**
   * Sandbox root for filesystem-backed tools. Every relative path the
   * agent passes is resolved against this directory; absolute paths
   * outside this root are rejected.
   */
  workingDirectory: string;
  /**
   * Optional override hook the runner uses to short-circuit a tool body
   * without invoking real I/O — primarily for the smoke parity test.
   * Production callers leave this undefined.
   */
  toolOverrides?: Partial<Record<string, ToolSet[string]>>;
}

/**
 * Resolve a relative `.env*` path under the sandbox. Mirrors the
 * defensive checks from `wizard-tools.ts:resolveEnvPath` — absolute
 * paths and paths with `..` are rejected as a defense in depth, even
 * though the AI-SDK tool layer doesn't yet enforce a write-gate.
 */
function resolveSandboxPath(workingDirectory: string, rel: string): string {
  const normalized = path.normalize(rel);
  if (path.isAbsolute(normalized)) {
    throw new Error(`[run-agent-tools] absolute paths not permitted: ${rel}`);
  }
  if (normalized.split(path.sep).includes('..')) {
    throw new Error(`[run-agent-tools] parent-traversal not permitted: ${rel}`);
  }
  return path.resolve(workingDirectory, normalized);
}

/**
 * Build the AI-SDK tool surface for the runner. Today this is a hand-
 * written subset; D-4 swaps the body for an `experimental_createMCPClient`
 * call against the existing in-process `wizard-tools` MCP server.
 *
 * Schemas mirror `src/lib/wizard-tools.ts` 1:1 — including the required
 * `reason` field — so the migration boundary is the *bridge*, not the
 * *contract*. Outer agents don't see a different tool shape on the AI
 * SDK path.
 */
export function buildAiSdkAgentTools(opts: AiSdkAgentToolsOptions): ToolSet {
  const { workingDirectory } = opts;

  const reasonField = z
    .string()
    .min(1)
    .max(400)
    .describe(
      'Why this tool call is needed at this step (≤25 words). Required.',
    );

  const checkEnvKeys = tool({
    description:
      'Check which environment variable keys are present or missing in a .env file. Never reveals values.',
    inputSchema: z.object({
      filePath: z
        .string()
        .describe('Path to the .env file, relative to the project root'),
      keys: z
        .array(z.string())
        .describe('Environment variable key names to check'),
      reason: reasonField,
    }),
    execute: (args: { filePath: string; keys: string[]; reason: string }) => {
      const resolved = resolveSandboxPath(workingDirectory, args.filePath);
      logToFile(
        `[ai-sdk] check_env_keys: ${resolved}, keys: ${args.keys.join(', ')}`,
      );
      const existing = new Set<string>();
      if (fs.existsSync(resolved)) {
        const body = fs.readFileSync(resolved, 'utf8');
        for (const line of body.split(/\r?\n/)) {
          const eq = line.indexOf('=');
          if (eq <= 0) continue;
          const key = line.slice(0, eq).trim();
          if (key && !key.startsWith('#')) existing.add(key);
        }
      }
      const result: Record<string, 'present' | 'missing'> = {};
      for (const key of args.keys) {
        result[key] = existing.has(key) ? 'present' : 'missing';
      }
      return result;
    },
  });

  const detectPackageManager = tool({
    description:
      'Detect the Node.js package manager(s) in use for this project (npm/yarn/pnpm/bun). Foundation tool — full multi-platform detection (pip/poetry/cargo/etc.) lands when the MCP bridge wraps `createWizardToolsServer` in Phase D-4.',
    inputSchema: z.object({ reason: reasonField }),
    execute: async () => {
      // Lazy import to avoid pulling the full detection helper into
      // hermetic test paths that override the tool body.
      const mod = await import('../package-manager-detection.js');
      const result = await mod.detectNodePackageManagers(workingDirectory);
      return {
        detected: result.detected,
        primary: result.primary?.name ?? null,
        recommendation: result.recommendation,
      };
    },
  });

  const reportStatus = tool({
    description:
      'Surface a one-line human-readable status to the wizard UI. The wizard maps this to the spinner / status pill so the user knows what step the agent is on.',
    inputSchema: z.object({
      message: z.string().min(1).max(200),
      reason: reasonField,
    }),
    execute: (args: { message: string; reason: string }) => {
      // The runner subscribes to status updates via getUI().pushStatus
      // — but to keep this module dependency-light we round-trip the
      // status as the tool result so the runner's onChunk sees it.
      logToFile(`[ai-sdk] report_status: ${args.message}`);
      return { ok: true, message: args.message };
    },
  });

  // ── File-change-emitting wrappers ───────────────────────────────────
  // The runner's PreToolUse / PostToolUse hooks would normally see Write
  // / Edit calls and emit `file_change_*` NDJSON. AI SDK 6 doesn't have
  // hook callbacks the same way the Agent SDK does, so we emit from
  // inside `execute` for now. When MCP bridging lands in D-4 the bridge
  // can host these hooks at the AI SDK boundary.
  const writeFile = tool({
    description:
      'Write file contents to a path inside the project, creating the file or overwriting it.',
    inputSchema: z.object({
      file_path: z.string().describe('Path relative to the project root'),
      content: z.string(),
      reason: reasonField,
    }),
    execute: (args: { file_path: string; content: string; reason: string }) => {
      const resolved = resolveSandboxPath(workingDirectory, args.file_path);
      emitFileChangePlanned({
        toolName: 'Write',
        toolInput: { file_path: args.file_path },
      });
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(resolved, args.content, 'utf8');
      const bytes = Buffer.byteLength(args.content, 'utf8');
      emitFileChangeApplied({
        toolName: 'Write',
        toolInput: { file_path: args.file_path },
        bytes,
      });
      return { ok: true, bytes };
    },
  });

  const tools: ToolSet = {
    check_env_keys: checkEnvKeys,
    detect_package_manager: detectPackageManager,
    report_status: reportStatus,
    write_file: writeFile,
  };

  // Test seam — production callers don't pass `toolOverrides`; the
  // smoke parity test stubs in MockTool implementations to avoid live
  // I/O.
  if (opts.toolOverrides) {
    for (const [name, override] of Object.entries(opts.toolOverrides)) {
      if (override) tools[name] = override;
    }
  }

  return tools;
}

/**
 * Names of every tool the AI-SDK runner advertises. Single source of
 * truth for the PreToolUse / PostToolUse middleware so it can decide
 * whether a tool name is one of ours (and therefore subject to the
 * wizard's write / status / env policies) or external (e.g. an MCP
 * tool bridged in by D-4 — at which point this list grows).
 */
export const AI_SDK_AGENT_TOOL_NAMES = [
  'check_env_keys',
  'detect_package_manager',
  'report_status',
  'write_file',
] as const;

export type AiSdkAgentToolName = (typeof AI_SDK_AGENT_TOOL_NAMES)[number];
