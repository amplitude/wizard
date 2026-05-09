/**
 * Tool surface for the AI-SDK inner-loop runner.
 *
 * The wizard-tools tool surface (~10 tools incl. `check_env_keys`,
 * `set_env_values`, `detect_package_manager`, `report_status`,
 * `confirm`, `choose`, `confirm_event_plan`, `wizard_feedback`,
 * `record_dashboard*`, the optional `load_skill*` tier tools) is
 * bridged via {@link bridgeWizardToolsMcp} (`run-agent-mcp-bridge.ts`)
 * — Phase D-4. That bridge consumes the same `createWizardToolsServer`
 * the legacy runner uses, so schemas stay in lockstep across both
 * runners.
 *
 * This file now hosts only tools that have NO wizard-tools MCP
 * equivalent and would have to be reimplemented natively for either
 * runner anyway:
 *
 *   - `write_file` — generic project-relative file write. Pre-D-4 the
 *     legacy runner relied on the Claude Agent SDK's built-in `Write`
 *     tool (kept under the SDK's permission gate). The AI-SDK runner
 *     doesn't have a built-in `Write`, so we provide a sandboxed
 *     equivalent here. The wizard-tools MCP intentionally does NOT
 *     expose generic file writes (only env-file mutations through
 *     `set_env_values`) — adding a generic write to wizard-tools would
 *     widen the legacy runner's surface unnecessarily.
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
 * Inputs the runner needs to assemble its native tool surface (the bits
 * that aren't bridged via the wizard-tools MCP).
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
 * Resolve a relative path under the sandbox. Mirrors the defensive checks
 * from `wizard-tools.ts:resolveEnvPath` — absolute paths and paths with
 * `..` are rejected as a defense in depth.
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
 * Build the AI-SDK native tool surface (the slice that isn't bridged via
 * the wizard-tools MCP). Today the only such tool is `write_file`.
 *
 * The bridged MCP tools land in the runner's combined `tools` map via
 * {@link bridgeWizardToolsMcp} — see `run-agent.ts`.
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

  // ── File-change-emitting wrappers ───────────────────────────────────
  // The runner's PreToolUse / PostToolUse hooks would normally see Write
  // / Edit calls and emit `file_change_*` NDJSON. AI SDK 6 doesn't have
  // hook callbacks the same way the Agent SDK does, so we emit from
  // inside `execute`.
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
      logToFile(`[ai-sdk] write_file: ${args.file_path} (${bytes}B)`);
      return { ok: true, bytes };
    },
  });

  const tools: ToolSet = {
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
 * Names of every NATIVE AI-SDK tool the runner advertises (i.e. tools
 * built in this file, not bridged from the wizard-tools MCP). The
 * bridged tool names live in the bridge's `toolNames` field at runtime.
 *
 * Used by diagnostics and tests; not consumed by the policy layer
 * (which keys on the normalized name instead — see
 * `normalizeAiSdkToolName` in `run-agent.ts`).
 */
export const AI_SDK_AGENT_TOOL_NAMES = ['write_file'] as const;

export type AiSdkAgentToolName = (typeof AI_SDK_AGENT_TOOL_NAMES)[number];
