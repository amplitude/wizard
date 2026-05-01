# amplitude-setup-report.md

You MUST write **`amplitude-setup-report.md`** at the project root before the run ends. The wizard's outro screen reads this file as the user-facing recap; without it the user has no record of what changed. Write it even after partial failures, missed steps, or running out of turns — a thinner report is far better than none.

The integration skill's `basic-integration-1.3-conclude.md` reference has the canonical format — load and follow it. If unavailable, write the report from session knowledge with at minimum:

- Integration summary (SDK installed, framework, init location)
- Events instrumented (table: event name, description, file path)
- Dashboard link (the URL you just passed to `record_dashboard`)
- Env var setup notes (what was set, what user needs for prod)
- Next steps

Wrap the body in `<wizard-report>...</wizard-report>` tags so the wizard knows it's intentional, not leftover.
