---
name: wizard-prompt-supplement
description: >
  Long-form wizard contracts moved out of the always-on system commandments
  to keep per-turn prompts small. Load when wiring API keys, before
  confirm_event_plan, when writing the post-instrumentation events manifest
  or setup report, or when generating browser SDK init. Pre-staged at
  .claude/skills/wizard-prompt-supplement/ — use Read on the reference files
  listed below; do not skip relevant sections for your current phase.
---

# Wizard prompt supplement

The static `commandments` block in the wizard stays intentionally short. **This skill holds the relocated detail** so you still follow the same rules — they are not optional.

## When to read what

| Phase | Read |
| ----- | ---- |
| Env vars, `.env`, client vs server keys | `references/api-keys-and-env.md` |
| Before `confirm_event_plan`, event naming, plan sizing, autocapture overlap | `references/confirm-event-plan-contract.md` |
| After `track()` calls, before dashboard | `references/post-instrumentation-events-and-dashboard.md` |
| After SDK init — grounded `POST /dashboards` hints (autocapture, display name, SDK version) | `references/wizard-dashboard-request-context.md` |
| `amplitude-setup-report.md` | `references/setup-report-requirements.md` |
| Browser / unified SDK init defaults (browser-targeting frameworks only) | `references/browser-sdk-init-defaults.md` |
| Why end-of-run lint must stay file-scoped | `references/lint-scoping.md` |

Use the **Read** tool on each path relative to this skill directory (e.g. `references/api-keys-and-env.md` from `.claude/skills/wizard-prompt-supplement/`).
