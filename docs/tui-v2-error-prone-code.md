# TUI v2: Error-Prone Code Analysis

Every known race condition, silent failure, and edge case — with fix suggestions.

---

## Severity: HIGH

### 1. AuthScreen async credential resolution race

**File:** `src/ui/tui/screens/AuthScreen.tsx` (lines ~137-252)

**Status: MITIGATED** — `useAsyncEffect` hook now provides AbortController-based cancellation for async effects. Screens that adopt `useAsyncEffect` get automatic stale-write prevention. However, AuthScreen's 5-step resolution chain has not yet been fully migrated to use `useAsyncEffect` throughout.

**The bug:** The credential resolution effect has a 9-element dependency array. If `selectedEnv` changes mid-flight (user picks a different environment while the backend fetch is running), the old fetch completes and writes credentials for the wrong environment.

**Why it's bad:** User ends up with API key for org A while thinking they selected org B. All subsequent API calls target the wrong project.

**Fix:** Migrate the full resolution chain to `useAsyncEffect`:
```ts
useAsyncEffect(async (signal) => {
  const result = await resolveCredentials();
  if (!signal.aborted) store.setCredentials(result);
}, [deps]);
```

---

### 2. DataSetupScreen frozen on API hang

**File:** `src/ui/tui/screens/DataSetupScreen.tsx`

**The bug:** `fetchProjectActivationStatus()` has no timeout. If the API hangs (network partition, DNS failure), the screen shows a spinner forever with no error message.

**Why it's bad:** User stares at "Checking project setup..." indefinitely. Only escape is force-quit.

**Fix:** Wrap in `Promise.race` with a 15-second timeout:
```ts
const status = await Promise.race([
  fetchProjectActivationStatus({ ... }),
  new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000)),
]);
```
On timeout, show: "Could not reach Amplitude. Check your connection and try again."

---

### 3. ConsoleView conversation history grows without bounds

**File:** `src/ui/tui/components/ConsoleView.tsx` (line ~113)

**The bug:** `history` state array grows with every AI query. Each new query sends the full history to the API. Over a long session, this causes increasing memory usage and network payload.

**Why it's bad:** Memory leak. After ~50 queries, payload becomes significant.

**Fix:** Cap history to last 10 turns:
```ts
setHistory((h) => [...h.slice(-8), { role: 'user', content: value }, { role: 'assistant', content: text }]);
```

---

### 4. DataIngestionCheckScreen polling continues after network failure

**File:** `src/ui/tui/screens/DataIngestionCheckScreen.tsx`

**The bug:** When `fetchProjectActivationStatus` fails, `apiUnavailable` is set to true, but the polling interval continues running. Each poll hits the same failing API, wasting resources and showing no error.

**Why it's bad:** CPU/network waste. User sees "Listening for events..." but polling is failing silently.

**Fix:** Clear the interval on API failure:
```ts
catch (err) {
  if (pollingRef.current !== null) clearInterval(pollingRef.current);
  setApiUnavailable(true);
  // ... fallback logic ...
}
```

---

## Severity: MEDIUM

### 5. RunScreen timer jumps on error recovery remount

**File:** `src/ui/tui/screens/RunScreen.tsx` (ProgressTab ~lines 134-143)

**The bug:** `startRef` initializes to `Date.now()` on component mount. If `ScreenErrorBoundary` catches an error and remounts the component, `startRef` resets to the new mount time, making the elapsed timer jump backward to 0.

**Fix:** Lift the start time into the store or use a module-level variable:
```ts
let runStartTime: number | null = null;
// In ProgressTab:
if (!runStartTime) runStartTime = Date.now();
```

---

### 6. MCP detection error indistinguishable from no-clients

**File:** `src/ui/tui/screens/McpScreen.tsx` (lines ~106-118)

**The bug:** When `installer.detectClients()` throws, the catch block shows "No supported MCP clients detected" — identical to the legitimate no-clients case.

**Why it's bad:** User thinks they have no editors installed when actually detection crashed.

**Fix:** Show different message for errors:
```ts
catch {
  setPhase(Phase.Error); // new phase
  // Render: "Could not detect editors. You can install MCP manually later."
}
```

---

### 7. MCP screen frozen in remove mode with pre-detection pending

**File:** `src/ui/tui/screens/McpScreen.tsx` (lines ~83-85, ~197)

**The bug:** If `amplitudePreDetectedChoicePending` is true and mode is `remove`, the detection useEffect returns early (line 84), but the choice UI only renders when `!isRemove` (line 197). Screen renders nothing actionable.

**Fix:** Skip the pre-detection check entirely in remove mode:
```ts
if (amplitudePreDetectedChoicePending && !isRemove) {
  return; // only block in install mode
}
```

---

### 8. ConsoleView event-plan prompt mode race

**File:** `src/ui/tui/components/ConsoleView.tsx` (lines ~226-269)

**The bug:** If the pending prompt clears from the store while the user is typing feedback, there's a brief window where keyboard input is processed in 'feedback' mode but the prompt no longer exists.

**Fix:** Check `pendingPrompt` at the start of the useInput handler AND the useEffect cleanup:
```ts
useInput((char, key) => {
  if (!pendingPrompt || pendingPrompt.kind !== 'event-plan') {
    setPlanInputMode('options');
    return;
  }
  // ... rest of handler
});
```

---

### 9. Stale org/workspace from prior session

**File:** `src/ui/tui/screens/AuthScreen.tsx` (lines ~82-89)

**Status: FIXED** — Cross-project config scoping fixes now validate org ID against live data. Zone priority (CLI flag > env var > stored config) prevents env var pollution. Org validation clears stale IDs when they don't match the current org list.

**The original bug:** `session.selectedOrgId` and `session.selectedWorkspaceId` could be pre-populated from a previous wizard run (via `~/.ampli.json`). If the user's org/workspace changed or they were using a different API key, these stale IDs caused the wrong org to be auto-selected.

---

### 10. RegionSelect + DataSetup state coupling

**File:** `src/ui/tui/store.ts` (`setRegionForced`)

**The bug:** `setRegionForced()` resets `projectHasData = null` to force a re-check. But DataSetupScreen's useEffect has an empty dependency array — it won't re-run after projectHasData is reset. Screen stays frozen.

**Fix:** DataSetupScreen should depend on `session.projectHasData`:
```ts
useEffect(() => {
  if (session.projectHasData !== null) return;
  // ... fetch activation status
}, [session.projectHasData]);
```

---

## Severity: LOW

### 11. JourneyStepper incomplete STEP_SCREENS mapping

If a new screen is added to flows.ts but not to `STEP_SCREENS` in JourneyStepper, that screen's progress state is always 'future'.

### 12. RunScreen file indicator flickers between file operations

Fixed in UX review (useRef persistence), but the regex `FILE_EXT_PATTERN` might miss non-standard extensions.

### 13. ChecklistScreen disabled items are focusable

PickerMenu doesn't support a `disabled` prop. Disabled checklist items receive cursor focus but do nothing on Enter.

### 14. OutroScreen report viewer has no scroll mechanism

If the setup report exceeds terminal height, bottom content is clipped with no indication.

### 15. Narrow terminal (<60 cols) degrades ungracefully

JourneyStepper collapses to dots, but ConsoleView and PickerMenu don't adapt. Long option labels overflow.

---

## New Issues (from session storage / agent mode additions)

### 16. Session checkpoint schema drift

**File:** `src/lib/session-checkpoint.ts`

**The risk:** `CheckpointSchema` (Zod) must be manually kept in sync with `WizardSession`. If a new field is added to the session that affects flow predicates (e.g., a new `activationLevel` value), but not added to the checkpoint schema, resume-from-crash will silently lose that state.

**Fix:** Add a build-time or test-time assertion that `CheckpointSchema` covers all restorable fields:
```ts
// In a test file:
const checkpointKeys = Object.keys(CheckpointSchema.shape);
const sessionKeys = Object.keys(buildSession({}));
const restorable = sessionKeys.filter(k => !CREDENTIAL_FIELDS.includes(k));
expect(checkpointKeys).toEqual(expect.arrayContaining(restorable));
```

### 17. Token refresh race with concurrent API calls

**File:** `src/utils/token-refresh.ts`

**The risk:** If multiple API calls discover the token is expired simultaneously, they could all trigger `tryRefreshToken()` in parallel. Each call exchanges the same refresh token, and depending on the OAuth provider, only the first exchange may succeed — subsequent ones may invalidate the new token.

**Fix:** Add a module-level mutex (Promise chain) so only one refresh runs at a time:
```ts
let refreshPromise: Promise<...> | null = null;
export function tryRefreshToken(...) {
  if (refreshPromise) return refreshPromise;
  refreshPromise = doRefresh(...).finally(() => { refreshPromise = null; });
  return refreshPromise;
}
```

### 18. AgentUI EPIPE on closed stdout

**File:** `src/ui/agent-ui.ts`

**The risk:** In agent mode, `emit()` writes directly to `process.stdout`. If the consuming process (pipe reader) exits early, the next write throws EPIPE and crashes the wizard.

**Fix:** Add an EPIPE handler or catch write errors:
```ts
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0); // consumer closed, exit cleanly
});
```
