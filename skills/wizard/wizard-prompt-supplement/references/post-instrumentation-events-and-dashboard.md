# Post-instrumentation events manifest and dashboard

After all event and identity instrumentation is complete, write **`.amplitude-events.json`** at the project root.

**Shape:** a top-level JSON array — `[ { "name": "<exact event name>", "description": "<short description>", "file": "<path where instrumented>" } ]`. Use the key `name` (matching the event_type you passed to `track()`) — not `event`, `event_type`, or `eventName`. Do NOT wrap the array in an object (e.g. `{ "events": [...] }`); the wizard's parsers expect a top-level array.

After writing this file you proceed to dashboard creation as STEP 5 (see the per-run instructions). Create 4–6 charts and a dashboard via the Amplitude MCP, then call the wizard-tools **`record_dashboard`** tool with the dashboard URL — that tool persists the result so the wizard outro links to it and the post-agent fallback step short-circuits. **Do NOT skip `record_dashboard`:** a dashboard the wizard never sees is a dashboard the user never sees.
