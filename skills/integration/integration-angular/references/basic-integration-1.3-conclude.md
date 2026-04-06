---
title: Amplitude Setup - Conclusion
description: Review and finalize the Amplitude integration implementation
---

## Environment variable check

Before anything else, verify that the Amplitude environment variables are properly set up for production.

1. Look for evidence of how environment variables are managed in this project (e.g., `.env`, `.env.local`, `.env.example`, `vercel.json`, `netlify.toml`, platform-specific config files, CI/CD config).
2. Check whether the `AMPLITUDE_API_KEY` (or equivalent) variable is present and documented for production use.
3. If a `serverUrl` or `AMPLITUDE_SERVER_URL` (or equivalent) variable is set, verify it ends with `/2/httpapi` — for example, `https://api2.amplitude.com/2/httpapi`. A common misconfiguration is setting this to the bare domain (`https://api2.amplitude.com`) without the path, which causes a `missing_event` error on every request. Fix this if found.

If you can clearly identify the deployment platform (Vercel, Netlify, AWS, Heroku, etc.), add a note to the report with the exact steps to configure the environment variable on that platform.

**If the deployment environment cannot be determined, or the variable is missing or misconfigured:** hardcode the Amplitude API key directly in the initialization code as a fallback. Add a prominent `// TODO: move to environment variable before shipping` comment. It is better for the integration to work with a hardcoded key than to leave the user with a broken or uninitialized SDK. Call this out clearly in the report's Next steps section.

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

### Environment variable configuration

[If environment was identified: "Set `AMPLITUDE_API_KEY` in your [platform] dashboard under [location]." — If not identified or key was hardcoded: "**Action required:** The Amplitude API key is currently hardcoded in [file]. Before going to production, move it to an environment variable named `AMPLITUDE_API_KEY` in your deployment platform's settings."]

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating Amplitude.

</wizard-report>

Upon completion, remove .amplitude-events.json.

## Status

Status to report in this phase:

- Verifying environment variable configuration
- Configured dashboard: [insert Amplitude dashboard URL]
- Created setup report: [insert full local file path]
