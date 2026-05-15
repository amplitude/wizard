# amplitude-setup-report.md

You MUST write **`amplitude-setup-report.md`** at the project root before the run ends. The wizard's outro screen reads this file as the user-facing recap; without it the user has no record of what changed. Write it even after partial failures, missed steps, or running out of turns — a thinner report is far better than none.

The integration skill's `basic-integration-1.3-conclude.md` reference has the canonical format — load and follow it. If unavailable, write the report from session knowledge with at minimum:

- Integration summary (SDK installed, framework, init location)
- Files changed table — Markdown table with columns: `File | Change | +lines / -lines`. Include every file you edited or created. This is the receipts ledger; missing entries hide work from the user.
- Events instrumented table — Markdown table with columns: `Event | File | Line | Properties captured`. One row per `track()` call you wrote.
- Reconciliation buckets (Instrumented / Covered by autocapture / Dropped — see the universal commandment for the contract).
- Env var setup notes (what was set, what user needs for prod) and any "Known limitations" surfaced by the strategy-retry cap.
- Next steps

Wrap the body in `<wizard-report>...</wizard-report>` tags so the wizard knows it's intentional, not leftover. Do NOT include a dashboard link — chart/dashboard creation is deferred to the `amplitude-wizard dashboard` command.
