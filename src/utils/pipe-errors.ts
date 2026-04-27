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
 * Both are no-ops once the pipe is broken — the data is silently dropped.
 * That's correct: there's nothing on the other end to receive it.
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
    if (isPipeError(err)) return; // swallow
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
    if (isPipeError(err)) return false;
    throw err;
  }
}

// Exported for unit tests only.
export const __test = { isPipeError, PIPE_ERROR_CODES };
