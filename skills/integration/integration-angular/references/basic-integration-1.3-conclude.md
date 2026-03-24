---
title: Amplitude Setup - Conclusion
description: Review and finalize the Amplitude integration implementation
---

Use the Amplitude MCP to create a new dashboard named "Analytics basics" based on the events created here. Make sure to use the exact same event names as implemented in the code. Populate it with up to five insights, with special emphasis on things like conversion funnels, churn events, and other business critical insights.

Search for a file called `.amplitude-events.json` and read it for available events. Do not spawn subagents.

Create the file amplitude-setup-report.md. It should include a summary of the integration edits, a table with the event names, event descriptions, and files where events were added, along with a list of links for the dashboard and insights created. Follow this format:

<wizard-report>
# Amplitude post-wizard report

The wizard has completed a deep integration of your project. [Detailed summary of changes]

[table of events/descriptions/files]

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

[links]

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating Amplitude.

</wizard-report>

Upon completion, remove .amplitude-events.json.

## Status

Status to report in this phase:

- Configured dashboard: [insert Amplitude dashboard URL]
- Created setup report: [insert full local file path]
