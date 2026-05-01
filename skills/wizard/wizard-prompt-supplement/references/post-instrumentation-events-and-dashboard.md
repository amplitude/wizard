# Post-instrumentation events manifest and dashboard

After all event and identity instrumentation is complete, persist the plan on disk. Prefer the canonical **`.amplitude/events.json`** (wizard mirrors to legacy **`.amplitude-events.json`** where needed).

**Shape:** top-level JSON array — `[ { "name": "<exact event name>", "description": "<short description>", "file": "<path where instrumented>", "category": "ACTIVATION" } ]`. Use **`name`** (matching the `track()` string). Optional **`category`** for the dashboard RPC must be one of `SIGNUP` \| `ACTIVATION` \| `ENGAGEMENT` \| `CONVERSION` \| `OTHER` — see `confirm-event-plan-contract.md`. Do NOT wrap in `{ "events": [...] }` unless your toolchain already unwraps it.

Write **`.amplitude/wizard-context.json`** after SDK init so **`autocaptureEnabled`** (and optionally **`productDisplayName`** / **`sdkVersion`**) match reality — see `wizard-dashboard-request-context.md`.

After writing this file you proceed to **STEP 5 documentation** (see the per-run instructions). Load `amplitude-chart-dashboard-plan` only to describe what the wizard's automated starter dashboard will contain in your setup report.

**Do not** call the Amplitude MCP `create_chart`, `create_dashboard`, or the wizard-tools `record_dashboard` tool for the starter dashboard — the wizard creates it server-side immediately after this agent run finishes.
