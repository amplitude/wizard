# TUI v2: Reliability Improvement Plan

How to ensure every run gets expected outcomes, only correct screens show, data is always fresh, and users are never confused.

---

## Part 1: Screen Visibility — Only Show What Should Show

### Problem: Predicates rely on state that may not be set yet

The flow predicates in `flows.ts` read session state synchronously, but much of that state is populated asynchronously (OAuth, API calls, framework detection). During the gap between wizard start and state population, predicates evaluate against default values, potentially showing or hiding screens incorrectly.

### Fixes

**1. Add explicit "ready" guards to async-dependent screens**

AuthScreen, DataSetupScreen, and DataIngestionCheckScreen all depend on async data. Instead of relying solely on flow predicates, each screen should have a loading state that shows until its required data is available:

```ts
// DataSetupScreen
if (!credentials) {
  return <Text color={Colors.muted}>Waiting for authentication...</Text>;
}
```

This prevents screens from rendering actionable UI before their dependencies resolve.

**2. Validate flow predicate inputs at the router level**

Add a debug mode that logs predicate evaluations:
```ts
// router.ts resolve() — add debug logging
if (process.env.AMPLITUDE_WIZARD_DEBUG) {
  for (const entry of this.flow) {
    const shown = !entry.show || entry.show(session);
    const complete = entry.isComplete?.(session) ?? false;
    logToFile(`[Router] ${entry.screen}: show=${shown} complete=${complete}`);
  }
}
```

This makes it trivial to diagnose "why did screen X show/not show?"

**3. Prevent premature completion via state machines**

Replace boolean completion flags with explicit state machines for complex screens:
```ts
// Instead of: session.mcpComplete (boolean)
// Use: session.mcpPhase: 'pending' | 'detecting' | 'installing' | 'done' | 'skipped' | 'error'
```

State machines make it impossible to transition from 'pending' directly to 'done' without going through intermediate states, preventing accidental completion.

---

## Part 2: Data Freshness — Always Correct, Never Stale

### Problem: Pre-populated session state from prior runs

The wizard reads `~/.ampli.json` and local `.env.local` to pre-populate credentials, org, workspace, and region. These can be stale if the user's Amplitude account changed, API keys were rotated, or they're running the wizard on a different project.

### Fixes

**4. Validate pre-populated state against live data**

After OAuth completes and `pendingOrgs` is available, validate that pre-populated `selectedOrgId` exists in the org list:
```ts
if (session.selectedOrgId && pendingOrgs) {
  const orgExists = pendingOrgs.some(o => o.id === session.selectedOrgId);
  if (!orgExists) {
    store.$session.setKey('selectedOrgId', null);
    store.$session.setKey('selectedWorkspaceId', null);
  }
}
```

**5. Add API key validation on startup**

Before using a stored API key, make a lightweight validation call (e.g., fetch project info). If it fails, discard the key and re-prompt:
```ts
const valid = await validateApiKey(storedKey, region);
if (!valid) {
  clearApiKey(installDir);
  store.setApiKeyNotice('Your saved API key is no longer valid. Please enter a new one.');
}
```

**6. Timestamp cached data and expire it**

Add a `lastValidated` timestamp to stored credentials. If >24 hours old, re-validate before using:
```ts
const stored = readApiKeyWithSource(installDir);
if (stored && Date.now() - stored.timestamp > 86400000) {
  // Re-validate before using
}
```

---

## Part 3: Network Resilience — Never Leave Users Stuck

### Problem: API calls with no timeout, no retry, no error UI

Multiple screens make API calls that can hang indefinitely. When they fail, error handling is inconsistent — some show messages, others silently fall through.

### Fixes

**7. Wrap all API calls in a timeout utility**

```ts
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
  );
  return Promise.race([promise, timeout]);
}

// Usage:
const status = await withTimeout(
  fetchProjectActivationStatus({ ... }),
  15000,
  'Activation check',
);
```

Apply to: `fetchProjectActivationStatus`, `fetchWorkspaceEventTypes`, `fetchOwnedDashboards`, `fetchSlackConnectionStatus`, `fetchSlackInstallUrl`, `getAPIKey`, `installer.detectClients`.

**8. Add retry with backoff for transient failures**

```ts
async function withRetry<T>(fn: () => Promise<T>, retries = 2, backoffMs = 2000): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, backoffMs * (i + 1)));
    }
  }
  throw new Error('unreachable');
}
```

**9. Show explicit error states, never silent fallthrough**

Every screen that makes API calls should have an error state that:
- Describes what failed ("Could not check your project status")
- Suggests an action ("Check your internet connection and press R to retry")
- Offers an escape ("Press q to exit and resume later")

Never show "no data" when the real situation is "API call failed."

---

## Part 4: Race Condition Elimination

### Problem: Concurrent async operations with shared state

OAuth, framework detection, API key resolution, and polling all run concurrently. They mutate shared session state without coordination, creating windows where state is inconsistent.

### Fixes

**10. Use abort controllers for all async effects**

```ts
useEffect(() => {
  const controller = new AbortController();
  
  void (async () => {
    try {
      const result = await fetchWithAbort(url, controller.signal);
      if (!controller.signal.aborted) {
        store.setActivationLevel(result.level);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err);
      }
    }
  })();
  
  return () => controller.abort();
}, [dependencies]);
```

This prevents stale async results from writing to state after the component unmounts or dependencies change.

**11. Gate concurrent operations with a sequence counter**

For AuthScreen's multi-step resolution:
```ts
const sequenceRef = useRef(0);

useEffect(() => {
  const seq = ++sequenceRef.current;
  
  void (async () => {
    // ... resolution logic ...
    if (seq !== sequenceRef.current) return; // superseded
    store.setCredentials(result);
  })();
}, [deps]);
```

**12. Clear polling intervals on ALL exit paths**

DataIngestionCheckScreen should clear its interval when:
- Component unmounts (cleanup function)
- API call fails (clear in catch block)
- Celebration starts (clear in confirmWithCelebration)
- User presses q/Esc (clear in useScreenInput handler)

Currently, some paths clear and others don't.

---

## Part 5: User Orientation — Never Confused

### Problem: Users don't know where they are, what's happening, or what to do

### Fixes

**13. Every screen must answer three questions**

For every screen, the user should instantly know:
1. **Where am I?** → JourneyStepper (already implemented)
2. **What's happening?** → Clear heading + status indicator
3. **What do I do next?** → KeyHintBar with available actions

Audit each screen against these criteria:

| Screen | Where | What's happening | What to do |
|--------|-------|-----------------|------------|
| Intro | Stepper | "Amplitude Wizard" heading | [Enter] Continue |
| Auth | Stepper | "Waiting for authentication" / "Select org" | Depends on step |
| DataSetup | Stepper | "Checking project setup" + spinner | Automatic |
| Run | Stepper | "3/5 tasks complete" + elapsed | Automatic + [L] toggle |
| DataIngestion | Stepper | "Listening for events (checked 12s ago)" | Framework hint + [q] exit |
| Checklist | Stepper | "Your events are flowing!" | [1-3] picker |
| Outro | Stepper | "Amplitude is live!" / error msg | [1-3] picker |

**14. Add transition context between screens**

When the router advances to a new screen, briefly show what completed:
```
✓ Authentication complete — signed in as kelson@amplitude.com
```

This 1-second flash (via the existing status message system) bridges the mental gap between screens.

**15. Show "why" for skipped screens**

When a screen is skipped (e.g., DataIngestionCheck for full-activation users), push a status message explaining why:
```ts
if (activationLevel === 'full') {
  store.pushStatus('Events already flowing — skipping verification.');
  store.setDataIngestionConfirmed();
}
```

---

## Part 6: Non-TUI Flow Improvements (CI/LoggingUI)

### Problem: CI mode has fewer guardrails than TUI

**16. Add the same timeout/retry wrappers to CI API calls**

CI mode uses `LoggingUI` which has no interactive error recovery. API hangs in CI are worse because there's no user to press q. All API calls in CI mode should have aggressive timeouts (10s) and clear error messages.

**17. Validate required args in CI mode upfront**

Before starting any async work in CI mode, validate that all required state is present:
```ts
if (options.ci) {
  if (!options.apiKey && !options.installDir) {
    abort('CI mode requires --api-key or --install-dir');
  }
}
```

**18. Add structured exit codes**

Instead of `process.exit(1)` for all failures, use specific codes:
- 0: success
- 1: general error
- 2: auth failure
- 3: network error
- 4: user cancelled
- 5: timeout

This lets CI pipelines distinguish between recoverable and unrecoverable failures.

---

## Implementation Priority

| # | Fix | Impact | Effort | Files |
|---|-----|--------|--------|-------|
| 7 | Timeout wrapper for all API calls | HIGH | LOW | New utility + 6 screens |
| 10 | Abort controllers in async effects | HIGH | MEDIUM | AuthScreen, DataSetupScreen, DataIngestionCheck |
| 4 | Validate pre-populated state | HIGH | LOW | AuthScreen, bin.ts |
| 9 | Explicit error states on all screens | HIGH | MEDIUM | All screens with API calls |
| 1 | Ready guards on async screens | MEDIUM | LOW | 3 screens |
| 5 | API key validation on startup | MEDIUM | LOW | bin.ts |
| 12 | Clear polling on all exit paths | MEDIUM | LOW | DataIngestionCheck |
| 13 | Three-question audit | MEDIUM | LOW | Audit + minor text changes |
| 3 | State machines for complex screens | MEDIUM | MEDIUM | MCP, Auth, DataIngestion |
| 15 | Show "why" for skipped screens | LOW | LOW | 4 screens |
| 8 | Retry with backoff | LOW | LOW | New utility |
| 14 | Transition context messages | LOW | LOW | Store + 5 screens |
| 18 | Structured exit codes | LOW | LOW | bin.ts |
