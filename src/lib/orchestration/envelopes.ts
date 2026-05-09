/**
 * Shared envelope builders for orchestration state.
 *
 * PR 3 introduces this module to centralize the JSON-emission layer that
 * was previously duplicated between `src/commands/orchestration.ts`,
 * `src/commands/choice.ts`, `src/commands/verification.ts`, and the new
 * `src/lib/wizard-mcp-server.ts` orchestration tools. Both surfaces now
 * call into the same builder and validate against the same Zod schemas
 * — guaranteeing the CLI's `--json` output and the MCP tool result are
 * byte-for-byte compatible (modulo `generatedAt`).
 *
 * **Read-side memoization.** The orchestration store reads from disk on
 * every `read()` (intentional — the file is small and the process is
 * short-lived). Within a single command/tool invocation we almost always
 * call `read()` 2-4 times and re-validate the same envelope; that's the
 * status-command cold-start hot path called out in PR 3's perf section.
 * `withReadCache(installDir, fn)` wraps a builder so successive calls
 * inside the same command/tool reuse the same parsed `OrchestrationStoreFile`
 * instead of re-parsing it. The cache is per-call (an opaque `key`) so
 * concurrent commands don't share state.
 *
 * **No mutation here.** Builders read the store and shape envelopes;
 * answering a Choice / marking a Verification still goes through the
 * matching mutator on `OrchestrationStore`. The MCP server stays
 * read-only by construction — it never imports any builder that writes.
 */
import {
  type OrchestrationStoreFile,
  type SessionId,
  type TaskId,
  asSessionId,
  asTaskId,
  type Task,
} from './state';
import {
  type Choice,
  type ChoiceId,
  ChoiceStatus,
  asChoiceId,
} from './checkpoints/choices';
import {
  type Verification,
  type VerificationId,
  VerificationStatus,
  asVerificationId,
} from './checkpoints/verifications';
import {
  type McpAppCapability,
  type McpAppCapabilityId,
  McpAppCapabilityState,
  asMcpAppCapabilityId,
} from './mcp-app-lifecycle';
import { TaskLifecycle } from './lifecycle';
import {
  StatusEnvelopeSchema,
  TasksEnvelopeSchema,
  TaskEnvelopeSchema,
  SessionsEnvelopeSchema,
  SessionEnvelopeSchema,
  ResumeEnvelopeSchema,
  ChoicesEnvelopeSchema,
  ChoiceEnvelopeSchema,
  VerificationsEnvelopeSchema,
  VerificationEnvelopeSchema,
  McpAppCapabilitySchema,
} from './schemas';
import { z } from 'zod';
import { computeLastStoppingPoint } from './last-stopping-point';
import { getOrchestrationStore } from './store';

// ── Per-invocation read-cache ────────────────────────────────────────
//
// Keyed by the actual Symbol *instance* via a Map<symbol, ...> so that
// two concurrent (or nested) `withReadCache` calls don't collide.
// Symbol.prototype.toString returns the description string and is NOT
// unique per instance, so a string-keyed cache scoped on
// `Symbol(<desc>).toString()` would alias every scope to the same key
// and the inner scope's `finally` cleanup would evict the outer scope's
// entries. Map-with-symbol-key sidesteps that entirely.

const readCache = new Map<symbol, Map<string, OrchestrationStoreFile>>();

/** Read the store, caching the parsed result for the lifetime of `key`. */
export function readStoreCached(
  installDir: string,
  key?: symbol,
): OrchestrationStoreFile {
  if (key === undefined) {
    return getOrchestrationStore(installDir).read();
  }
  let scope = readCache.get(key);
  if (!scope) {
    scope = new Map();
    readCache.set(key, scope);
  }
  let cached = scope.get(installDir);
  if (!cached) {
    cached = getOrchestrationStore(installDir).read();
    scope.set(installDir, cached);
  }
  return cached;
}

/**
 * Run `fn` with a fresh per-invocation cache key so multiple builders
 * called inside the same logical command share a single store read.
 *
 * Tests / one-off callers can skip this and just call the builders
 * directly — the `key`-less path always reads from disk.
 */
export function withReadCache<T>(fn: (key: symbol) => T): T {
  const key = Symbol('orch-read-cache');
  try {
    return fn(key);
  } finally {
    // Drop every entry created under this key so a long-lived process
    // (e.g. the MCP server) doesn't accumulate stale snapshots. Since
    // the cache is now scoped by the unique Symbol instance, a single
    // delete is enough — no string-prefix walk needed.
    readCache.delete(key);
  }
}

/** Test helper — clears the entire cache. */
export function _resetEnvelopeReadCache(): void {
  readCache.clear();
}

// ── Tiny envelope schemas added in PR 3 ──────────────────────────────
//
// PR 2 already published envelopes for choices and verifications. PR 3
// adds a `last_stopping_point` envelope (shorter than the full status
// envelope) and the MCP-capability list/get envelopes. Both live here
// because the CLI commands and the MCP server tools share them.

export const LastStoppingPointEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.literal('orchestration_last_stopping_point'),
  generatedAt: z.string(),
  installDir: z.string(),
  // We re-import the LSP shape from schemas indirectly via StatusEnvelopeSchema
  // to avoid duplicating the field list. Pull the inner type:
  lastStoppingPoint: StatusEnvelopeSchema.shape.lastStoppingPoint,
});
export type LastStoppingPointEnvelope = z.infer<
  typeof LastStoppingPointEnvelopeSchema
>;

export const McpCapabilitiesEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.literal('orchestration_mcp_capabilities'),
  generatedAt: z.string(),
  installDir: z.string(),
  capabilities: z.array(McpAppCapabilitySchema),
});
export type McpCapabilitiesEnvelope = z.infer<
  typeof McpCapabilitiesEnvelopeSchema
>;

export const McpCapabilityEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.literal('orchestration_mcp_capability'),
  generatedAt: z.string(),
  installDir: z.string(),
  capability: McpAppCapabilitySchema,
});
export type McpCapabilityEnvelope = z.infer<typeof McpCapabilityEnvelopeSchema>;

// ── Builders ─────────────────────────────────────────────────────────
//
// Each builder takes `installDir` (always required so callers pin the
// project), an optional `cacheKey` (for deduplicating store reads inside
// a single command), and any filter args. They return the validated
// envelope object — callers serialize it (CLI: `JSON.stringify`, MCP:
// `JSON.stringify` inside `jsonContent`).

interface BuilderOpts {
  installDir: string;
  cacheKey?: symbol;
  /** Override `now()` for deterministic envelopes in tests. */
  now?: () => Date;
}

function nowIso(opts?: BuilderOpts): string {
  return (opts?.now?.() ?? new Date()).toISOString();
}

// ── Status / LSP / resume ────────────────────────────────────────────

export function buildStatusEnvelope(
  opts: BuilderOpts,
): z.infer<typeof StatusEnvelopeSchema> {
  const store = getOrchestrationStore(opts.installDir);
  // Forward the per-invocation cache key (when present) into LSP via
  // `storeFile` so the status envelope shares one snapshot with the
  // other section builders inside `withReadCache`. Without this, the
  // status path triggered an independent `store.read()` per render and
  // the cache stated purpose ("one snapshot per render, shared across
  // every section") was defeated.
  const file = readStoreCached(opts.installDir, opts.cacheKey);
  const lsp = computeLastStoppingPoint(opts.installDir, { storeFile: file });
  return StatusEnvelopeSchema.parse({
    v: 1,
    type: 'orchestration_status',
    generatedAt: nowIso(opts),
    installDir: opts.installDir,
    storePath: store.path,
    storeExists: store.exists(),
    lastStoppingPoint: lsp,
  });
}

export function buildLastStoppingPointEnvelope(
  opts: BuilderOpts,
): LastStoppingPointEnvelope {
  const lsp = computeLastStoppingPoint(opts.installDir);
  return LastStoppingPointEnvelopeSchema.parse({
    v: 1,
    type: 'orchestration_last_stopping_point',
    generatedAt: nowIso(opts),
    installDir: opts.installDir,
    lastStoppingPoint: lsp,
  });
}

export function buildResumeEnvelope(
  opts: BuilderOpts & { sessionId: SessionId; executed?: boolean },
): z.infer<typeof ResumeEnvelopeSchema> {
  const lsp = computeLastStoppingPoint(opts.installDir);
  return ResumeEnvelopeSchema.parse({
    v: 1,
    type: 'orchestration_resume',
    generatedAt: nowIso(opts),
    installDir: opts.installDir,
    sessionId: opts.sessionId,
    command: lsp.nextAction.command,
    description: lsp.nextAction.description,
    executed: opts.executed ?? false,
  });
}

// ── Tasks ────────────────────────────────────────────────────────────

export function buildTasksEnvelope(
  opts: BuilderOpts & {
    state?: TaskLifecycle;
    sessionId?: SessionId;
  },
): z.infer<typeof TasksEnvelopeSchema> {
  const file = readStoreCached(opts.installDir, opts.cacheKey);
  let tasks: Task[] = file.tasks;
  if (opts.sessionId) {
    tasks = tasks.filter((t) => t.sessionId === opts.sessionId);
  }
  if (opts.state) {
    tasks = tasks.filter((t) => t.state === opts.state);
  }
  return TasksEnvelopeSchema.parse({
    v: 1,
    type: 'orchestration_tasks',
    generatedAt: nowIso(opts),
    installDir: opts.installDir,
    tasks,
  });
}

export function buildTaskEnvelope(
  opts: BuilderOpts & { taskId: TaskId },
): z.infer<typeof TaskEnvelopeSchema> | null {
  const file = readStoreCached(opts.installDir, opts.cacheKey);
  const task = file.tasks.find((t) => t.id === opts.taskId);
  if (!task) return null;
  return TaskEnvelopeSchema.parse({
    v: 1,
    type: 'orchestration_task',
    generatedAt: nowIso(opts),
    installDir: opts.installDir,
    task,
  });
}

// ── Sessions ─────────────────────────────────────────────────────────

export function buildSessionsEnvelope(
  opts: BuilderOpts,
): z.infer<typeof SessionsEnvelopeSchema> {
  const file = readStoreCached(opts.installDir, opts.cacheKey);
  return SessionsEnvelopeSchema.parse({
    v: 1,
    type: 'orchestration_sessions',
    generatedAt: nowIso(opts),
    installDir: opts.installDir,
    sessions: file.sessions,
  });
}

export function buildSessionEnvelope(
  opts: BuilderOpts & { sessionId: SessionId },
): z.infer<typeof SessionEnvelopeSchema> | null {
  const file = readStoreCached(opts.installDir, opts.cacheKey);
  const session = file.sessions.find((s) => s.id === opts.sessionId);
  if (!session) return null;
  const tasks = file.tasks.filter((t) => t.sessionId === session.id);
  return SessionEnvelopeSchema.parse({
    v: 1,
    type: 'orchestration_session',
    generatedAt: nowIso(opts),
    installDir: opts.installDir,
    session,
    tasks,
  });
}

// ── Choices ──────────────────────────────────────────────────────────

export function buildChoicesEnvelope(
  opts: BuilderOpts & {
    status?: ChoiceStatus | ChoiceStatus[];
    sessionId?: SessionId;
  },
): z.infer<typeof ChoicesEnvelopeSchema> {
  const file = readStoreCached(opts.installDir, opts.cacheKey);
  let choices: Choice[] = file.choices;
  if (opts.sessionId) {
    choices = choices.filter((c) => c.linkedSessionId === opts.sessionId);
  }
  if (opts.status) {
    const set = new Set(
      Array.isArray(opts.status) ? opts.status : [opts.status],
    );
    choices = choices.filter((c) => set.has(c.status));
  }
  return ChoicesEnvelopeSchema.parse({
    v: 1,
    type: 'orchestration_choices',
    generatedAt: nowIso(opts),
    installDir: opts.installDir,
    choices,
  });
}

export function buildChoiceEnvelope(
  opts: BuilderOpts & { choiceId: ChoiceId },
): z.infer<typeof ChoiceEnvelopeSchema> | null {
  const file = readStoreCached(opts.installDir, opts.cacheKey);
  const choice = file.choices.find((c) => c.id === opts.choiceId);
  if (!choice) return null;
  return ChoiceEnvelopeSchema.parse({
    v: 1,
    type: 'orchestration_choice',
    generatedAt: nowIso(opts),
    installDir: opts.installDir,
    choice,
  });
}

// ── Verifications ────────────────────────────────────────────────────

export function buildVerificationsEnvelope(
  opts: BuilderOpts & {
    status?: VerificationStatus | VerificationStatus[];
    sessionId?: SessionId;
  },
): z.infer<typeof VerificationsEnvelopeSchema> {
  const file = readStoreCached(opts.installDir, opts.cacheKey);
  let verifications: Verification[] = file.verifications;
  if (opts.sessionId) {
    verifications = verifications.filter(
      (v) => v.blockingSessionId === opts.sessionId,
    );
  }
  if (opts.status) {
    const set = new Set(
      Array.isArray(opts.status) ? opts.status : [opts.status],
    );
    verifications = verifications.filter((v) => set.has(v.status));
  }
  return VerificationsEnvelopeSchema.parse({
    v: 1,
    type: 'orchestration_verifications',
    generatedAt: nowIso(opts),
    installDir: opts.installDir,
    verifications,
  });
}

export function buildVerificationEnvelope(
  opts: BuilderOpts & { verificationId: VerificationId },
): z.infer<typeof VerificationEnvelopeSchema> | null {
  const file = readStoreCached(opts.installDir, opts.cacheKey);
  const verification = file.verifications.find(
    (v) => v.id === opts.verificationId,
  );
  if (!verification) return null;
  return VerificationEnvelopeSchema.parse({
    v: 1,
    type: 'orchestration_verification',
    generatedAt: nowIso(opts),
    installDir: opts.installDir,
    verification,
  });
}

// ── MCP capabilities ─────────────────────────────────────────────────

export function buildMcpCapabilitiesEnvelope(
  opts: BuilderOpts & {
    state?: McpAppCapabilityState | McpAppCapabilityState[];
    sessionId?: SessionId;
  },
): McpCapabilitiesEnvelope {
  const file = readStoreCached(opts.installDir, opts.cacheKey);
  let capabilities: McpAppCapability[] = file.mcpCapabilities;
  if (opts.sessionId) {
    capabilities = capabilities.filter(
      (c) => c.linkedSessionId === opts.sessionId,
    );
  }
  if (opts.state) {
    const set = new Set(Array.isArray(opts.state) ? opts.state : [opts.state]);
    capabilities = capabilities.filter((c) => set.has(c.state));
  }
  return McpCapabilitiesEnvelopeSchema.parse({
    v: 1,
    type: 'orchestration_mcp_capabilities',
    generatedAt: nowIso(opts),
    installDir: opts.installDir,
    capabilities,
  });
}

export function buildMcpCapabilityEnvelope(
  opts: BuilderOpts & { capabilityId: McpAppCapabilityId },
): McpCapabilityEnvelope | null {
  const file = readStoreCached(opts.installDir, opts.cacheKey);
  const capability = file.mcpCapabilities.find(
    (c) => c.id === opts.capabilityId,
  );
  if (!capability) return null;
  return McpCapabilityEnvelopeSchema.parse({
    v: 1,
    type: 'orchestration_mcp_capability',
    generatedAt: nowIso(opts),
    installDir: opts.installDir,
    capability,
  });
}

// Re-export typed id constructors so callers building envelopes can
// accept stringly-typed CLI input via the same path the schemas use.
export {
  asSessionId,
  asTaskId,
  asChoiceId,
  asVerificationId,
  asMcpAppCapabilityId,
};

// Also expose the schemas grouped by surface so a test file can iterate
// over all CLI<->MCP envelope types without re-importing each one.
export const ENVELOPE_SCHEMAS = {
  status: StatusEnvelopeSchema,
  lastStoppingPoint: LastStoppingPointEnvelopeSchema,
  tasks: TasksEnvelopeSchema,
  task: TaskEnvelopeSchema,
  sessions: SessionsEnvelopeSchema,
  session: SessionEnvelopeSchema,
  resume: ResumeEnvelopeSchema,
  choices: ChoicesEnvelopeSchema,
  choice: ChoiceEnvelopeSchema,
  verifications: VerificationsEnvelopeSchema,
  verification: VerificationEnvelopeSchema,
  mcpCapabilities: McpCapabilitiesEnvelopeSchema,
  mcpCapability: McpCapabilityEnvelopeSchema,
} as const;
