# TUI: Engineering Patterns for Deterministic, Bug-Free CLI

Research synthesis from Vercel CLI, Stripe CLI, GitHub CLI, Railway CLI, Ink, XState, fast-check, and production observability patterns.

---

## 1. Async Effect Safety (from Ink + React research)

### Problem
Async effects in Ink components (API calls, polling, timers) can write to state after the component unmounts, causing stale updates or memory leaks.

### Pattern: AbortController in every async effect

```ts
useEffect(() => {
  const controller = new AbortController();
  void (async () => {
    try {
      const result = await fetchStatus({ signal: controller.signal });
      if (!controller.signal.aborted) {
        store.setActivationLevel(result.level);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (!controller.signal.aborted) setError(err);
    }
  })();
  return () => controller.abort();
}, [deps]);
```

### Pattern: Sequence counter for multi-step resolution

```ts
const genRef = useRef(0);
useEffect(() => {
  const gen = ++genRef.current;
  void (async () => {
    const result = await resolveCredentials();
    if (gen !== genRef.current) return; // superseded
    store.setCredentials(result);
  })();
}, [deps]);
```

### Pattern: Ref for current state in long-lived intervals

```ts
const sessionRef = useRef(store.session);
sessionRef.current = store.session; // update every render
useEffect(() => {
  const id = setInterval(() => {
    const { credentials } = sessionRef.current; // never stale
    if (credentials) pollIngestion(credentials);
  }, 30_000);
  return () => clearInterval(id);
}, []);
```

---

## 2. Error Classification + Retry (from Vercel/Stripe/GitHub CLI)

### Pattern: Typed error hierarchy

```ts
class WizardAPIError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryable: boolean,
    public suggestion?: string,
    public docsUrl?: string,
  ) { super(message); }
}
```

### Pattern: Retry with bail-on-4xx

```ts
async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; label?: string } = {},
): Promise<T> {
  const { retries = 2, label = 'API call' } = opts;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof WizardAPIError && !err.retryable) throw err; // bail
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // backoff
    }
  }
  throw new Error('unreachable');
}
```

### Pattern: Timeout wrapper

```ts
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
  );
  return Promise.race([promise, timeout]);
}
```

---

## 3. State Machine Patterns (from XState/Robot research)

### Pattern: Make illegal states unrepresentable

Instead of nullable fields that allow impossible combinations:

```ts
// BAD: credentials null but runPhase is 'running'
interface Session { credentials: Creds | null; runPhase: RunPhase; }

// GOOD: discriminated union enforces valid combinations
type Session =
  | { phase: 'intro' }
  | { phase: 'authed'; credentials: Creds; region: Region }
  | { phase: 'running'; credentials: Creds; region: Region; integration: Integration }
  | { phase: 'completed'; credentials: Creds; outroData: OutroData };
```

### Pattern: Transition functions instead of direct mutation

```ts
function completeAuth(s: IntroSession, creds: Creds, region: Region): AuthedSession {
  return { ...s, phase: 'authed', credentials: creds, region };
}
```

### Pattern: Exhaustive switch with assertNever

```ts
function assertNever(x: never): never {
  throw new Error(`Unexpected: ${JSON.stringify(x)}`);
}
function getScreen(s: Session): Screen {
  switch (s.phase) {
    case 'intro': return Screen.Intro;
    case 'authed': return Screen.Auth;
    case 'running': return Screen.Run;
    case 'completed': return Screen.Outro;
    default: return assertNever(s);
  }
}
```

---

## 4. Testing (from fast-check/ink-testing-library research)

### Pattern: Property-based testing for flow invariants

Use fast-check model-based testing to generate random state mutation sequences and verify invariants hold:

```ts
fc.assert(fc.property(fc.commands(allCommands), (cmds) => {
  const setup = () => ({
    model: {},
    real: { router: new WizardRouter(), session: buildSession({}) },
  });
  fc.modelRun(setup, cmds);
}), { numRuns: 500 });
```

**Invariants to check:**
- Error state never shows post-success screens (MCP, Checklist, Slack)
- Unauthenticated users never see Run screen
- Router always returns a valid Screen value
- Screens never go backward in flow order

### Pattern: ink-testing-library for component rendering

```ts
const { lastFrame, stdin } = render(<IntroScreen store={mockStore()} />);
expect(lastFrame()).toContain('Amplitude Wizard');
stdin.write('\r'); // Enter
expect(store.session.introConcluded).toBe(true);
```

---

## 5. Observability (from Vercel/Turbo/pnpm research)

### Pattern: Structured NDJSON logging

```ts
function logStructured(level: string, msg: string, meta?: Record<string, unknown>) {
  const entry = { ts: new Date().toISOString(), level, msg, ...meta };
  appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
}
```

### Pattern: Flow evaluation for debugging

```ts
function evaluateFlow(session: WizardSession): Array<{
  screen: string; visible: boolean; complete: boolean; active: boolean;
}> {
  let foundActive = false;
  return FLOWS[Flow.Wizard].map((entry) => {
    const visible = entry.show ? entry.show(session) : true;
    const complete = visible && entry.isComplete ? entry.isComplete(session) : false;
    const active = visible && !complete && !foundActive;
    if (active) foundActive = true;
    return { screen: entry.screen, visible, complete, active };
  });
}
```

### Pattern: Diagnostic snapshot (/debug command)

Dump sanitized session state, flow evaluation, and screen history to a JSON file that users can share with support. Never include tokens, API keys, or PII — only structural/categorical data.

### Pattern: Three-tier debug levels

| Flag | Level | What shows |
|------|-------|-----------|
| (none) | WARN | Errors and warnings only |
| `--verbose` | INFO | Screen transitions, framework detection, OAuth status |
| `--debug` | DEBUG | Router decisions, session mutations, API call metadata |

---

## 6. Memory Safety (from Ink long-running app research)

### Pattern: Cap unbounded arrays

```ts
pushStatus(message: string): void {
  const current = this.$statusMessages.get();
  const next = current.length >= 500
    ? [...current.slice(-250), message]
    : [...current, message];
  this.$statusMessages.set(next);
}
```

### Pattern: Cancel stacked timeouts

```ts
private _feedbackTimer: ReturnType<typeof setTimeout> | null = null;
setCommandFeedback(message: string, ms = 3000): void {
  if (this._feedbackTimer) clearTimeout(this._feedbackTimer);
  this.$commandFeedback.set(message);
  this._feedbackTimer = setTimeout(() => {
    this._feedbackTimer = null;
    this.$commandFeedback.set(null);
    this.emitChange();
  }, ms);
}
```

### Pattern: Stable useSyncExternalStore references

```ts
function useWizardStore(store: WizardStore): number {
  return useSyncExternalStore(
    store.subscribe.bind(store),
    store.getSnapshot.bind(store),
  );
}
```

---

## 7. User-Facing Error Messages (from all 4 CLIs)

### Pattern: Error envelope with actionable guidance

Every error shown to the user should have:
1. **What happened** — red prefix, clear message
2. **Why it happened** — one-sentence context
3. **What to do** — specific action or command
4. **Where to learn more** — docs link

```
Error: Could not reach Amplitude API
  The activation check timed out after 15 seconds.
  Check your internet connection, then press R to retry.
  Docs: https://amplitude.com/docs/wizard-troubleshooting
```

### Pattern: Network error classification

```ts
function classifyNetworkError(err: NodeJS.ErrnoException): { message: string; suggestion: string } {
  switch (err.code) {
    case 'ENOTFOUND': return { message: 'Could not resolve hostname.', suggestion: 'Check your internet connection.' };
    case 'ECONNRESET': return { message: 'Connection was reset.', suggestion: 'Try again in a few seconds.' };
    case 'ETIMEDOUT': return { message: 'Request timed out.', suggestion: 'Check your network or try again.' };
    default: return { message: `Network error: ${err.message}`, suggestion: 'Check your connection.' };
  }
}
```

---

## 8. Persistence Layer Patterns (from session storage implementation)

### Pattern: Atomic file writes

Never write directly to config files. Use temp-file + rename to prevent corruption on crash:

```ts
// src/utils/atomic-write.ts
function atomicWriteJSON(filePath: string, data: unknown, mode = 0o644): void {
  const tmp = `${filePath}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode });
    renameSync(tmp, filePath); // atomic on POSIX
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* best-effort cleanup */ }
    throw err;
  }
}
```

### Pattern: Zod-validated checkpoints

Always validate serialized state on load. Never trust the shape of data read from disk:

```ts
const result = CheckpointSchema.safeParse(raw);
if (!result.success) return null; // silently discard malformed data
```

### Pattern: Scoped + TTL'd persistence

Checkpoints are scoped to a specific install directory and expire after 24 hours:

```ts
if (checkpoint.installDir !== installDir) return null; // wrong project
if (age > MAX_AGE_MS) return null; // stale
```

This prevents cross-project state leakage and avoids restoring outdated state.

### Pattern: Credential-free snapshots

Never persist secrets in checkpoints. Strip tokens and API keys before writing; re-evaluate them on resume:

```ts
// Checkpoint includes: region, orgId, integration, frameworkContext, introConcluded
// Checkpoint excludes: credentials, accessToken, projectApiKey, runPhase
```

### Pattern: Silent token refresh with fallback

Attempt token refresh transparently before it expires. On any failure, fall back to the full auth flow:

```ts
const refreshed = await tryRefreshToken(storedEntry, zone);
if (refreshed) { /* use new token */ }
else { /* fall back to browser OAuth */ }
```

### Pattern: Zone priority for config scoping

When multiple sources specify a region/zone, use a strict priority order to prevent env var pollution:

```
CLI flag (--region) > env var (AMPLITUDE_ZONE) > stored config (~/.ampli.json)
```

---

## Applied To This Codebase

The following changes have been made to implement these patterns:

1. **`src/ui/tui/utils/with-timeout.ts`** — Timeout wrapper for all API calls
2. **`src/ui/tui/utils/with-retry.ts`** — Retry with bail-on-4xx for transient failures
3. **`src/ui/tui/hooks/useAsyncEffect.ts`** — AbortController-based async effect hook
4. **`src/ui/tui/utils/diagnostics.ts`** — Flow evaluation + diagnostic snapshot for `/debug`
5. **Store patches** — Capped status messages, cancellable feedback timer
6. **`src/utils/atomic-write.ts`** — Crash-safe JSON writes via temp-file + rename
7. **`src/utils/token-refresh.ts`** — Silent OAuth token refresh with 5-minute proactive buffer
8. **`src/lib/session-checkpoint.ts`** — Zod-validated session checkpointing with 24-hour TTL
9. **`src/lib/mode-config.ts`** — Execution mode resolution (interactive/ci/agent)
10. **`src/lib/exit-codes.ts`** — Structured exit codes for CI/agent consumers
11. **`src/ui/tui/utils/classify-error.ts`** — Network error classification with actionable messages
12. **`src/ui/agent-ui.ts`** — NDJSON WizardUI for agent mode (security-hardened, credential-redacted)
