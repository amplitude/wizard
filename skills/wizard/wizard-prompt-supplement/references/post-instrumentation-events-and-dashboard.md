# Post-instrumentation events manifest and dashboard

After all event and identity instrumentation is complete, write **`.amplitude-events.json`** at the project root.

**Shape:** a top-level JSON array — `[ { "name": "<exact event name>", "description": "<short description>", "file": "<path where instrumented>" } ]`. Use the key `name` (matching the event_type you passed to `track()`) — not `event`, `event_type`, or `eventName`. Do NOT wrap the array in an object (e.g. `{ "events": [...] }`); the wizard's parsers expect a top-level array.

After writing this file you proceed to **STEP 5 documentation** (see the per-run instructions). Load `amplitude-chart-dashboard-plan` only to describe what the wizard's automated starter dashboard will contain in your setup report.

**Do not** call the Amplitude MCP `create_chart`, `create_dashboard`, or the wizard-tools `record_dashboard` tool for the starter dashboard — the wizard creates it server-side immediately after this agent run finishes.
