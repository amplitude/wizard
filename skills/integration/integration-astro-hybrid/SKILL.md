---
name: integration-astro-hybrid
description: >-
  Amplitude integration for Astro hybrid rendering with both static and
  server-rendered pages
metadata:
  author: Amplitude
  version: dev
---

# Amplitude integration for Astro (Hybrid)

This skill helps you add Amplitude analytics to Astro (Hybrid) applications.

## Workflow

Follow these steps in order to complete the integration:

1. `basic-integration-1.0-begin.md` - Amplitude Setup - Begin ← **Start here**
2. `basic-integration-1.1-edit.md` - Amplitude Setup - Edit
3. `basic-integration-1.2-revise.md` - Amplitude Setup - Revise
4. `basic-integration-1.3-conclude.md` - Amplitude Setup - Conclusion

## Reference files

- `references/EXAMPLE.md` - Astro (Hybrid) example project code
- `references/basic-integration-1.0-begin.md` - Amplitude setup - begin
- `references/basic-integration-1.1-edit.md` - Amplitude setup - edit
- `references/basic-integration-1.2-revise.md` - Amplitude setup - revise
- `references/basic-integration-1.3-conclude.md` - Amplitude setup - conclusion

The example project shows the target implementation pattern. Consult the documentation for API details.

## Key principles

- **Environment variables**: Always use environment variables for Amplitude keys. Never hardcode them.
- **Minimal changes**: Add Amplitude code alongside existing integrations. Don't replace or restructure existing code.
- **Match the example**: Your implementation should follow the example project's patterns as closely as possible.
- **Unified SDK**: For new browser/frontend projects, use `@amplitude/unified` as the default SDK — it bundles Analytics, Session Replay, Experiment, and Guides & Surveys in a single package. Initialize with `initAll()`. Only use `@amplitude/analytics-browser` if the project already has it installed.
- **Event naming**: Event names MUST use Title Case with spaces following the [Noun] + [Past-Tense Verb] pattern (e.g., "Button Clicked", "Sign Up Completed", "Cart Viewed"). Do NOT use snake_case, camelCase, or SCREAMING_SNAKE. Property names should use snake_case (e.g., button_text, page_url).
- **No PII in events**: Never send PII (emails, full names, phone numbers, physical addresses, IP addresses) in `track()` event properties. PII belongs in `identify()` user properties only.
- **Autocapture**: Enable autocapture in the init config to automatically capture sessions, page views, form interactions, and file downloads. Use the `autocapture` config option (not the deprecated `defaultTracking`).

## Identifying users

Identify users during login and signup events. Refer to the example code and documentation for the correct identify pattern for this framework. Call `amplitude.setUserId(userId)` to associate events with a known user, and use `amplitude.identify()` with an `Identify` object to set user properties. Call `amplitude.reset()` on logout to unlink future events from the current user. If both frontend and backend code exist, pass a consistent user/device ID via custom request headers to maintain event correlation.
