# confirm_event_plan and event-plan contract

After installing the SDK and adding init code, but **BEFORE** writing any `track()` calls, you MUST call `confirm_event_plan` to present the proposed instrumentation plan. Only proceed after approval. If the user gives feedback, revise and call again. If skipped, do not instrument any events.

## CRITICAL — name format

Title Case, [Noun] [Past-Tense Verb], 2-5 words. The name passed here is the **EXACT** string the agent passes as the first argument to `track()` — do not translate or reformat it between this call and the implementation.

- WRONG: `user_signed_up` (snake_case), `userSignedUp` (camelCase), `user signed up` (lowercase), "Fires when user submits the signup form" (description in name field)
- RIGHT: "User Signed Up", "Product Added To Cart", "Search Performed", "Checkout Started", "Property Extracted"

**description:** ONE short sentence (≤20 words) stating when the event fires. No file paths, property lists, or autocapture rationale.

Names >50 chars are auto-truncated.

**Exception:** only when Phase 1 of the full-repo-instrumentation skill confirms an existing convention (5+ existing tracking calls, ≥80% consistent, intentionally codified). One or two stray strings do NOT qualify.

## Optional — `category` per event (wizard-proxy dashboard planner)

You MAY add **`category`** on each event row so **`POST /dashboards`** can plan funnels/retention more accurately. Allowed values **only**: `SIGNUP`, `ACTIVATION`, `ENGAGEMENT`, `CONVERSION`, `OTHER` (exact spelling, upper case). Wrong or unknown values are ignored client-side — prefer omitting to guessing.

Use **one** category per custom event when the role is clear (e.g. signup flow → `SIGNUP`, core habit → `ENGAGEMENT`). Do not encode category in the **event name**; keep names as human actions per the rules above.

## CRITICAL — `confirm_event_plan` owns the plan JSON

`confirm_event_plan` owns the initial write of `.amplitude/events.json` (mirrored to legacy `.amplitude-events.json`). Do NOT write either file yourself before or during the `confirm_event_plan` flow with a different shape (`event_name`, `eventName`, `file_path`, etc.) — drifting from the canonical `[{ name, description, category? }, …]` shape will render blank bullets in the Event Plan viewer.

After all instrumentation is complete you MAY rewrite `.amplitude-events.json` to add the `file` field per the post-instrumentation reference, but you must keep the canonical `name` / `description` keys.

## CRITICAL — full-repo instrumentation event count

When running full-repo-instrumentation (initial across an entire codebase, not a small targeted change), the plan MUST contain 10–30 critical/high/medium events sized to the repo: ~10–15 small (1–2 product areas), ~15–25 medium (3–4 areas), ~25–30 large (multiple features, full user journeys). Fewer than 10 is acceptable ONLY for a genuinely tiny surface (one-page demo, two-command CLI) — verify by re-reading product-map.json. If your initial plan has <10 events on a non-trivial repo, you've under-scoped: re-read user flows for segmentation, alternate paths, configuration events, friction points, then call again. Does NOT apply to incremental reruns scoped to a single changed area, or non-full-repo workflows.

## CRITICAL — funnel-start coverage

Every product area with a multi-step flow MUST have a "funnel start" event marked critical (clicks into a checkout flow card, opens the signup form, opens a paywall). The "no raw clicks without outcomes" rule does NOT apply to funnel-starts; entry-point intent IS the outcome. End events without matching starts means you can't compute conversion rates — re-scope.

## CRITICAL — async-branch coverage

When placing a track call in an async handler (server action, API route, webhook, payment confirmation, mutation), walk every terminal branch (success, failure, validation-error, early return, switch case) and decide whether each fires a track call OR has downstream coverage. Webhook switches over event types (`switch (event.type) { ... }`) are the most common miss — every case representing a meaningful user-facing outcome must fire or be explicitly noted as covered elsewhere.

## CRITICAL — property symmetry across multi-callsite events

When the same event name fires from multiple callsites (e.g. "Donation Completed" from three result pages), property keys MUST be identical across every callsite. Compute the union of useful in-scope variables, emit every key from that union at every callsite — fill flow-specific values from a constant if needed (e.g. `payment_flow: "embedded_checkout"` vs `"hosted_checkout"`). Asymmetric properties silently break charts.

## CRITICAL — identify wiring

For any flow with authenticated users or a post-conversion identifier (email at checkout, customer ID after payment, session-bound user ID after sign-in), the plan MUST include an identify call (`amplitude.setUserId` + `amplitude.identify(new Identify().set(...))` for browser/node SDKs; `client.identify(Identify(user_id=..., user_properties={...}))` for Python) at the earliest point the identifier is available. If the codebase has zero auth and no post-conversion identifier, state that explicitly and skip; otherwise mandatory.

---

## Autocapture vs proposed events

Autocapture (Amplitude's auto-tracking of element clicks, form interactions, page/screen views, sessions, app lifecycle, file downloads) is commonly enabled by the wizard for web SDKs (`@amplitude/unified`, `@amplitude/analytics-browser`) but is NOT default everywhere (Swift requires opt-in plugin; backend SDKs don't track interactions; existing projects may have it off). Before proposing events, check the SDK init code to see whether autocapture is on and what it covers for this platform. If on, do NOT propose events that duplicate it — names like "[X] Clicked", "[X] Tapped", "[X] Pressed", "Form Submitted", "Form Started", "Input Changed", "Page Viewed", "Screen Viewed" are redundant and must be excluded. Either way, prefer events for business outcomes, state changes, async success/failure, and multi-step flow milestones over raw interaction events (see `skills/instrumentation/discover-event-surfaces/references/best-practices.md` section R4). For landing pages or starter templates with autocapture on, lean toward a minimal plan and let autocapture do the work — `confirm_event_plan` still requires at least one event, so pick the single most meaningful state change. Keep this reasoning internal — do NOT write autocapture justifications into descriptions.
