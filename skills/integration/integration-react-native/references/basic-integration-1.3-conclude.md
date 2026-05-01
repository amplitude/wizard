---
title: Amplitude Setup - Conclusion
description: Review and finalize the Amplitude integration implementation
---

## Environment variable check

Before anything else, verify that the Amplitude environment variables are properly set up for production.

1. Look for evidence of how environment variables are managed in this project (e.g., `.env`, `.env.local`, `.env.example`, `vercel.json`, platform-specific config files, CI/CD config).
2. Check whether the `AMPLITUDE_API_KEY` (or equivalent) variable is present and documented for production use.
3. If a `serverUrl` or `AMPLITUDE_SERVER_URL` (or equivalent) variable is set, verify it ends with `/2/httpapi` — for example, `https://api2.amplitude.com/2/httpapi`. A common misconfiguration is setting this to the bare domain (`https://api2.amplitude.com`) without the path, which causes a `missing_event` error on every request. Fix this if found.

If you can clearly identify the deployment platform, add a note to the report with the exact steps to configure the environment variable on that platform.

**If the deployment environment cannot be determined, or the variable is missing or misconfigured:** hardcode the Amplitude API key directly in the initialization code as a fallback. Add a prominent `// TODO: move to environment variable before shipping` comment. Call this out clearly in the report's Next steps section.

---

## Dashboard

Load `.claude/skills/amplitude-chart-dashboard-plan/SKILL.md` via the Skill tool
and follow it for **documentation only** — summarize what the wizard's automated
starter dashboard will contain (funnels, retention, autocapture coverage) in your
setup report.

**Do not** call the Amplitude MCP `create_chart`, `create_dashboard`, or the
wizard-tools `record_dashboard` tool. The Amplitude Wizard creates the starter
dashboard server-side after this agent run finishes.

Mark the "Build your starter dashboard" todo completed once you have documented
the expected dashboard layout in the setup report (per the chart-dashboard-plan skill).

---

## Setup report

Create the file `amplitude-setup-report.md`. Include:
- A summary of the integration edits
- A table with event names, descriptions, and files where events were added

Follow this format:

<wizard-report>
# Amplitude post-wizard report

The wizard has completed a deep integration of your project. [Detailed summary of changes]

[table of events/descriptions/files]

## Next steps

### Environment variable configuration

[If environment was identified: "Set `AMPLITUDE_API_KEY` in your [platform] dashboard under [location]." — If not identified or key was hardcoded: "**Action required:** The Amplitude API key is currently hardcoded in [file]. Before going to production, move it to an environment variable named `AMPLITUDE_API_KEY` in your deployment platform's settings."]

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code.

</wizard-report>

## Status

Status to report in this phase:

- Verifying environment variable configuration
- Created setup report: [insert full local file path]
