---
name: integration-javascript_web
description: >-
  Amplitude integration for client-side web JavaScript applications using
  @amplitude/analytics-browser
metadata:
  author: Amplitude
  version: 1.2.0
---

# Amplitude integration for JavaScript Web

This skill helps you add Amplitude analytics to JavaScript Web applications.

## Workflow

Follow these steps in order to complete the integration:

1. `basic-integration-1.0-begin.md` - Amplitude Setup - Begin ← **Start here**
2. `basic-integration-1.1-edit.md` - Amplitude Setup - Edit
3. `basic-integration-1.2-revise.md` - Amplitude Setup - Revise
4. `basic-integration-1.3-conclude.md` - Amplitude Setup - Conclusion

## Reference files

- `references/browser-sdk-2.md` - Or install unified SDK to get access to all Amplitude products
- `references/amplitude-quickstart.md` - Amplitude documentation for Amplitude Quickstart
- `references/basic-integration-1.0-begin.md` - Amplitude setup - begin
- `references/basic-integration-1.1-edit.md` - Amplitude setup - edit
- `references/basic-integration-1.2-revise.md` - Amplitude setup - revise
- `references/basic-integration-1.3-conclude.md` - Amplitude setup - conclusion

The example project shows the target implementation pattern. Consult the documentation for API details.

## Key principles

- **Environment variables**: Always use environment variables for Amplitude keys. Never hardcode them.
- **Minimal changes**: Add Amplitude code alongside existing integrations. Don't replace or restructure existing code.
- **Match the example**: Your implementation should follow the example project's patterns as closely as possible.

## Framework guidelines

- Remember that source code is available in the node_modules directory
- Check package.json for type checking or build scripts to validate changes
- @amplitude/analytics-browser is the browser JavaScript SDK package name
- amplitude.init() MUST be called before any other Amplitude methods (track, identify, etc.)
- @amplitude/analytics-browser is browser-only — do NOT import it in Node.js or server-side contexts (use @amplitude/analytics-node instead)
- Autocapture is available with the Amplitude Browser SDK via the autocapture plugin. It is NOT enabled by default — opt in explicitly if the user requests it.
- NEVER send PII in amplitude.track() event properties — no emails, full names, phone numbers, physical addresses, IP addresses, or user-generated content
- PII belongs in amplitude.identify() person properties (email, name, role), NOT in track() event properties
- Call amplitude.setUserId(userId) on login AND on page refresh if the user is already logged in; use amplitude.identify() with an Identify object to set user properties
- Call amplitude.reset() on logout to unlink future events from the current user
- For SPAs without a framework router, use the pageViewTracking option in amplitude.init() or manually call amplitude.track('Page Viewed', { path }) for History API routing

## Identifying users

Identify users during login and signup events. Refer to the example code and documentation for the correct identify pattern for this framework. Call `amplitude.setUserId(userId)` to associate events with a known user, and use `amplitude.identify()` with an `Identify` object to set user properties. If both frontend and backend code exist, pass a consistent user/device ID via custom request headers to maintain event correlation.
