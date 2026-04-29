/**
 * Pipe-error resilience for stdout/stderr writes.
 *
 * Why this exists:
 *
 *   The wizard writes structured NDJSON to stdout in agent mode and
 *   human-readable status lines elsewhere. When the receiving end of
 *   stdout/stderr closes mid-run (the parent process dies, the user
 *   pipes through `head`, an outer agent crashes, etc.), Node emits an
 *   `EPIPE` on the next write. If nothing handles the resulting `error`
 *   event, Node throws it as an uncaught exception and the wizard
 *   crashes — visible in production Sentry as WIZARD-CLI-8 (`emit` at
 *   `agent-ui.ts`) and WIZARD-CLI-5 (`afterWriteDispatched` in
 *   `stream_base_commons`). Fatal-level events from real users.
 *
 * Two layers cover both the sync and async failure modes:
 *
 *   1. `installPipeErrorHandlers()` attaches process-level `error`
 *      listeners on `process.stdout` and `process.stderr` that swallow
 *      EPIPE (and the related EIO / ECONNRESET pipe-reset codes).
 *      Catches the async `afterWriteDispatched` path where the error
 *      surfaces a tick after the synchronous write call returned.
 *
 *   2. `safePipeWrite(stream, data)` wraps a synchronous write call so
 *      a thrown EPIPE during the write itself doesn't bubble up. Use
 *      from any code path that writes user output and shouldn't crash
 *      the run on a broken pipe.
 *
 * On first pipe break, both layers register a one-shot trigger that
 * schedules `abortWizard()` (in agent / non-TUI contexts) so the
 * wizard exits cleanly rather than continuing to produce output that
 * silently disappears. Without this, an orchestrator that drops its
 * read end mid-stream would still be billed for a long-running agent
 * run that has no audience.
 *
 * Subsequent writes after the pipe break are still no-ops — the data
 * is silently dropped because there's nothing on the other end to
 * receive it. The single-shot abort guarantees we don't burn cycles
 * on a doomed run.
 *
 * Idempotent. `installPipeErrorHandlers()` may be called multiple times
 * (e.g. once from `bin.ts`, once from `agent-ui.ts` module init) without
 * stacking listeners.
 */

const PIPE_ERROR_CODES = new Set([
  'EPIPE', // Receiver closed the pipe
  'EIO', // I/O error on the underlying fd
  'ECONNRESET', // TCP-style reset, occasionally surfaces on stdio sockets
]);

/**
 * Type guard for Node ErrnoException-shaped errors. Avoids a bare
 * `(err as NodeJS.ErrnoException).code` cast and keeps the runtime
 * check honest about the property's presence.
 */
function isPipeError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && PIPE_ERROR_CODES.has(code);
}

/**
 * One-shot trigger flag. The first detected pipe break schedules an
 * `abortWizard()` call; subsequent breaks are no-ops (the wizard is
 * already on its way out). Module-level state because the flag has
 * to be shared across the two detection layers (sync `safePipeWrite`
 * try/catch + async `process.stdout.on('error', ...)` listener).
 */
let _pipeAbortTriggered = false;

/**
 * Pluggable abort dispatcher. Defaults to dynamically importing
 * `./wizard-abort` (avoids the circular load — `wizard-abort.ts`
 * imports `./ui` which imports `./agent-ui` which imports this
 * file). Tests inject a synchronous mock via
 * `__setPipeAbortDispatcherForTests` so they don't have to wrestle
 * with vi.mock and dynamic-import resolution timing.
 */
type AbortDispatcher = () => void | Promise<void>;

/**
 * Shape of the dynamically-imported `./wizard-abort` module surface
 * we depend on. Hand-typed (vs `import type`) because TypeScript can
 * lose narrow types through `await import()` under some module-mode
 * settings, leaving downstream calls flagged as `any` by ESLint. A
 * structural interface keeps the consumer code strongly typed.
 */
interface WizardAbortModuleShape {
  abortWizard: (reason?: string) => void;
  wizardAbort: (options?: {
    message?: string;
    exitCode?: number;
  }) => Promise<never>;
}

const defaultAbortDispatcher: AbortDispatcher = async () => {
  try {
    // Cast through `unknown` to neutralize the `any`-typed surface of
    // `await import()` under our tsconfig — TypeScript can lose
    // narrow types through dynamic-import in nodenext module mode.
    // The structural cast keeps downstream calls strongly typed.
    const mod = (await import(
      './wizard-abort.js'
    )) as unknown as WizardAbortModuleShape;
    // First flip the wizard-wide AbortController so any in-flight
    // async work (agent SDK query, MCP fetches, ingestion polls)
    // unwinds before wizardAbort starts running cleanup. Without
    // this the abort would race with whatever was mid-flight.
    mod.abortWizard('stdout pipe closed by consumer');
    await mod.wizardAbort({
      message: 'Output stream closed by consumer.',
      exitCode: 130,
    });
  } catch {
    // wizardAbort either successfully calls process.exit (in which
    // case we don't get here), or it threw before exit. In the
    // latter case, force-exit so we don't keep running on a doomed
    // pipe.
    process.exit(130);
  }
};

let _abortDispatcher: AbortDispatcher = defaultAbortDispatcher;

/**
 * Schedule a wizard abort in response to a broken pipe. Idempotent —
 * only the FIRST call schedules; subsequent calls are no-ops.
 *
 * Why deferred via `setImmediate`: the abort is dispatched from
 * within a stream-write code path. Calling `abortWizard()` directly
 * could re-enter the same write path (analytics, logging, etc.) and
 * trigger weird ordering. Deferring lets the current stack unwind
 * first, then the abort runs cleanly on the next tick.
 *
 * `USER_CANCELLED` (130) is the right exit code: the receiver going
 * away is functionally identical to the user pressing Ctrl+C from
 * the wizard's perspective — there's no audience left for our
 * output.
 */
function triggerPipeAbort(): void {
  if (_pipeAbortTriggered) return;
  _pipeAbortTriggered = true;
  setImmediate(() => {
    void _abortDispatcher();
  });
}

/** Test-only reset for `_pipeAbortTriggered`. */
export const __resetPipeAbortTriggeredForTests = (): void => {
  _pipeAbortTriggered = false;
};

/**
 * Mark the wizard as "already exiting" so any future EPIPE detected
 * by `safePipeWrite` / the stream error listener short-circuits
 * instead of scheduling a deferred `wizardAbort`.
 *
 * Why this exists: `wizardSuccessExit` and `wizardAbort` write to
 * stdout (e.g. the `run_completed` NDJSON event) AFTER the consumer
 * may have closed the pipe. Without this flag, that write hits EPIPE,
 * `triggerPipeAbort` schedules `setImmediate(() => wizardAbort())`,
 * and the deferred abort fires during the success path's own
 * analytics-shutdown await — calling `process.exit(130)` before the
 * success path reaches `process.exit(0)`. CI watchers see code 130
 * (USER_CANCELLED) on a fully successful run.
 *
 * Calling this idempotent setter at the START of every exit funnel
 * suppresses the race: we're already on the way out, the deferred
 * abort would just stomp our exit code. Bugbot finding (Medium).
 */
export const suppressPipeAbort = (): void => {
  _pipeAbortTriggered = true;
};

/** Test-only dispatcher injection. Pass `null` to restore the default. */
export const __setPipeAbortDispatcherForTests = (
  dispatcher: AbortDispatcher | null,
): void => {
  if (dispatcher === null) {
    _abortDispatcher = defaultAbortDispatcher;
    return;
  }
  _abortDispatcher = dispatcher;
};

/**
 * Attach error listeners to `process.stdout` / `process.stderr` that
 * swallow EPIPE-class errors. Idempotent — subsequent calls are no-ops.
 *
 * Call once at process start (e.g. from `bin.ts`). Listeners persist
 * for the lifetime of the process; we never remove them.
 */
let installed = false;
export function installPipeErrorHandlers(): void {
  if (installed) return;
  installed = true;

  const handler = (err: unknown): void => {
    if (isPipeError(err)) {
      // Pipe is broken — schedule a clean abort so we don't keep
      // running with no audience. Subsequent writes still no-op via
      // safePipeWrite; the abort will fire on the next tick.
      triggerPipeAbort();
      return;
    }
    // Anything else is a real error — re-throw so the default
    // unhandled-error path runs and Sentry sees it.
    throw err;
  };

  // Use the streams' own error event, not 'uncaughtException' — the
  // latter would catch unrelated errors. EventEmitter's API is
  // stable across the Node versions we support (>=20).
  process.stdout.on('error', handler);
  process.stderr.on('error', handler);
}

/**
 * Synchronously write `data` to `stream`, swallowing EPIPE-class
 * errors. Returns true if the write was queued, false if the pipe is
 * already broken (data dropped).
 *
 * The async `error` listener installed by `installPipeErrorHandlers`
 * still fires on the same write if the failure is delayed past the
 * synchronous return — both layers are needed because Node can route
 * the error either way depending on the stream's internal state.
 */
export function safePipeWrite(
  stream: NodeJS.WritableStream,
  data: string,
): boolean {
  try {
    return stream.write(data);
  } catch (err) {
    if (isPipeError(err)) {
      // Same one-shot trigger as the async listener — the first
      // detected EPIPE schedules a clean abort. Subsequent writes
      // hit this branch and no-op until the deferred abort fires.
      triggerPipeAbort();
      return false;
    }
    throw err;
  }
}

// Exported for unit tests only.
export const __test = { isPipeError, PIPE_ERROR_CODES };
