# Audit 9.1 — Post-auth welcome banner

**Category:** TUI
**Effort:** S
**Status:** Implemented.

## What changed

Added a small welcome banner above the OAuth-waiting spinner in
`AuthScreen.tsx`:

```
• Sign in to Amplitude
  We use your browser to securely fetch your API key — the wizard never
  sees or stores your password.
```

Shown only when we're on step 1 (no completed steps yet) so it doesn't
repeat after the user advances to org/workspace/project pickers.

This sets the user's expectation up front: OAuth steals focus, and the
old wizard said "Waiting for authentication…" with no context —
returning users would sometimes think it was hung. The banner makes the
security story explicit and gives the blank time a reason.
