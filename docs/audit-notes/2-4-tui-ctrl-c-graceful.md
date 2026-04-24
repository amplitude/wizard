# Audit 2.4 — Graceful Ctrl+C

**Category:** TUI
**Effort:** S
**Status:** Implemented.

## What changed

Improved the first-Ctrl+C experience in `bin.ts`:

1. Push a visible "Saving session… press Ctrl+C again to force quit."
   status into the TUI before starting checkpoint + analytics flush, so
   users aren't staring at a frozen screen.
2. Bumped the force-kill timer from 1s to 2s to give Sentry +
   analytics flush a realistic window.
3. Kept the double-Ctrl+C fast path unchanged — second Ctrl+C
   immediately `process.exit(130)`.
4. Exit code remains 130 (SIGINT convention).
