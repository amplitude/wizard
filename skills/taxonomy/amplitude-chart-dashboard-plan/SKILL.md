---
name: amplitude-chart-dashboard-plan
description: >
  Amplitude Chart & Dashboard Planning Skill — explains how the wizard's
  automated starter dashboard maps to the instrumented event taxonomy.
  Use after event instrumentation is complete. Documentation-only: the
  wizard creates charts and the dashboard via the wizard-proxy REST API.
---

# Amplitude Chart & Dashboard Planning Skill

You are an expert Amplitude implementation strategist. After instrumentation,
your job is to **describe** what signal the product team will see — the same
shape an experienced analytics engineer would aim for on day one — so the
setup report sets expectations.

This skill runs **after** instrumentation is complete. Do not re-plan events.
Work with exactly the events that were instrumented.

**Do not** call the Amplitude MCP chart/dashboard tools or wizard-tools
`record_dashboard`. The Amplitude Wizard builds the starter dashboard
server-side right after this agent run using your `.amplitude-events.json`.

---

## Inputs

1. **`.amplitude-events.json`** — lists every event name (and optionally
   description) that was instrumented.

2. **Taxonomy funnels** — from `amplitude-quickstart-taxonomy-agent` or your
   own read of the events. Identify 2–5 product funnels (Onboarding, Core Loop,
   Conversion, …).

3. **Autocapture** — when relevant for web SDKs, note Amplitude Autocapture
   (`[Amplitude] Page Viewed`, `[Amplitude] Element Clicked`, …). The server's
   planner may include autocapture segmentation when enabled.

---

## What to document for the setup report

Explain how events roll up into the automated starter dashboard:

### Acquisition / activation signal

- Which instrumented events represent signup vs activation.
- Which funnel the wizard is likely to emphasize given ordering + categories.

### Core loop + conversion

- Primary value actions and any checkout / upgrade events worth calling out.

### Retention anchor

- Which event best represents "got value" for retention (activation anchor).

### Autocapture vs custom events

- Which panels populate immediately (traffic / Autocapture) vs after users hit
  specific flows (custom events).

---

## Autocapture + future events

Some charts may show zero data early because:

1. The app hasn't been used since instrumentation.
2. Instrumented events require specific user actions.

Call this out explicitly in the setup report.

---

## Dashboard naming / sections (reference only)

The server names the dashboard deterministically (product-derived). Sections
typically follow **Acquisition → Activation → Engagement → Retention** style
layouts — describe that structure qualitatively so stakeholders know what to
open first.

---

## Quality bar

An expert implementation strategist would verify:

- Event names in prose match **exact** `track()` / instrumentation strings.
- At least one narrative ties Autocapture / traffic to “signal without waiting
  for rare events”.
- Retention language anchors on a meaningful activation moment when one exists
  in the plan.

---

## Todo / checklist

Mark **Build your starter dashboard** complete once this documentation is
reflected in `amplitude-setup-report.md` — not after MCP calls.
