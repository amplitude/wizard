# TUI v2: Error-Prone Code Analysis

Every known race condition, silent failure, and edge case — with fix suggestions.

---

## Severity: HIGH

### 1. AuthScreen async credential resolution race

**File:** `src/ui/tui-v2/screens/AuthScreen.tsx` (lines ~137-252)

**The bug:** The credential resolution effect has a 9-element dependency array. If `selectedEnv` changes mid-flight (user picks a different environment while the backend fetch is running), the old fetch completes and writes credentials for the wrong environment.

**Why it's bad:** User ends up with API key for org A while thinking they selected org B. All subsequent API calls target the wrong project.

**Fix:** Add an abort controller or generation counter:
```ts
const genRef = useRef(0);
useEffect(() => {
  const gen = ++genRef.current;
  // ... async work ...
  if (gen !== genRef.current) return; // stale
  store.setCredentials(...);
}, [deps]);
```

---

### 2. DataSetupScreen frozen on API hang

**File:** `src/ui/tui-v2/screens/DataSetupScreen.tsx`

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

**File:** `src/ui/tui-v2/components/ConsoleView.tsx` (line ~113)

**The bug:** `history` state array grows with every AI query. Each new query sends the full history to the API. Over a long session, this causes increasing memory usage and network payload.

**Why it's bad:** Memory leak. After ~50 queries, payload becomes significant.

**Fix:** Cap history to last 10 turns:
```ts
setHistory((h) => [...h.slice(-8), { role: 'user', content: value }, { role: 'assistant', content: text }]);
```

---

### 4. DataIngestionCheckScreen polling continues after network failure

**File:** `src/ui/tui-v2/screens/DataIngestionCheckScreen.tsx`

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

**File:** `src/ui/tui-v2/screens/RunScreen.tsx` (ProgressTab ~lines 134-143)

**The bug:** `startRef` initializes to `Date.now()` on component mount. If `ScreenErrorBoundary` catches an error and remounts the component, `startRef` resets to the new mount time, making the elapsed timer jump backward to 0.

**Fix:** Lift the start time into the store or use a module-level variable:
```ts
let runStartTime: number | null = null;
// In ProgressTab:
if (!runStartTime) runStartTime = Date.now();
```

---

### 6. MCP detection error indistinguishable from no-clients

**File:** `src/ui/tui-v2/screens/McpScreen.tsx` (lines ~106-118)

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

**File:** `src/ui/tui-v2/screens/McpScreen.tsx` (lines ~83-85, ~197)

**The bug:** If `amplitudePreDetectedChoicePending` is true and mode is `remove`, the detection useEffect returns early (line 84), but the choice UI only renders when `!isRemove` (line 197). Screen renders nothing actionable.

**Fix:** Skip the pre-detection check entirely in remove mode:
```ts
if (amplitudePreDetectedChoicePending && !isRemove) {
  return; // only block in install mode
}
```

---

### 8. ConsoleView event-plan prompt mode race

**File:** `src/ui/tui-v2/components/ConsoleView.tsx` (lines ~226-269)

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

**File:** `src/ui/tui-v2/screens/AuthScreen.tsx` (lines ~82-89)

**The bug:** `session.selectedOrgId` and `session.selectedWorkspaceId` can be pre-populated from a previous wizard run (via `~/.ampli.json`). If the user's org/workspace changed or they're using a different API key, these stale IDs cause wrong org to be auto-selected.

**Fix:** Validate pre-populated IDs against the `pendingOrgs` list:
```ts
const prePopulatedOrg = session.selectedOrgId && pendingOrgs
  ? pendingOrgs.find((o) => o.id === session.selectedOrgId) ?? null
  : null;
// If prePopulatedOrg is null but selectedOrgId exists, clear it
if (!prePopulatedOrg && session.selectedOrgId && pendingOrgs) {
  // stale org ID — force picker
}
```

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
