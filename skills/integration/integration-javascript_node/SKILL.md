---
name: integration-javascript_node
description: >-
  Amplitude integration for server-side Node.js applications using
  @amplitude/analytics-node
metadata:
  author: Amplitude
  version: dev
---

# Amplitude integration for JavaScript Node

This skill helps you add Amplitude analytics to JavaScript Node applications.

## Workflow

Follow these steps in order to complete the integration:

1. `basic-integration-1.0-begin.md` - Amplitude Setup - Begin ← **Start here**
2. `basic-integration-1.1-edit.md` - Amplitude Setup - Edit
3. `basic-integration-1.2-revise.md` - Amplitude Setup - Revise
4. `basic-integration-1.3-conclude.md` - Amplitude Setup - Conclusion

## Reference files

- `references/EXAMPLE.md` - JavaScript Node example project code
- `references/analytics.md` - Amplitude documentation for Analytics
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

- @amplitude/analytics-node is the Node.js server-side SDK package name — do NOT use @amplitude/analytics-browser on the server
- Add amplitude.track() calls in route handlers for meaningful user actions — every route that creates, updates, or deletes data should track an event with contextual properties
- In long-running servers, the SDK batches events automatically — do NOT set flushQueueSize or flushIntervalMillis unless you have a specific reason to
- For short-lived processes (scripts, CLIs, serverless), call await amplitude.flush() before the process exits to ensure all events are sent
- Reverse proxy is NOT needed for server-side Node.js — only client-side JavaScript may benefit from a proxy to avoid ad blockers
- Remember that source code is available in the node_modules directory
- Check package.json for type checking or build scripts to validate changes

## Identifying users

Identify users during login and signup events. Refer to the example code and documentation for the correct identify pattern for this framework. Call `amplitude.setUserId(userId)` to associate events with a known user, and use `amplitude.identify()` with an `Identify` object to set user properties. If both frontend and backend code exist, pass a consistent user/device ID via custom request headers to maintain event correlation.
