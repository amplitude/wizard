---
name: integration-astro-hybrid
description: >-
  Amplitude integration for Astro hybrid rendering with both static and
  server-rendered pages
metadata:
  author: Amplitude
  version: 1.2.1
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

- Always use the is:inline directive on Amplitude script tags to prevent Astro from processing them and causing TypeScript errors
- Use PUBLIC_ prefix for client-side environment variables in Astro (e.g., PUBLIC_AMPLITUDE_API_KEY)
- Create an amplitude.astro component in src/components/ for reusable initialization across pages
- Import the Amplitude component in a Layout and wrap all pages with that layout
- Use @amplitude/analytics-node in API routes under src/pages/api/ for server-side event tracking
- Store the Amplitude node client instance in a singleton pattern (src/lib/amplitude-server.ts) to avoid creating multiple clients
- In Astro 5, use output static (the default) with an adapter - pages are prerendered by default
- Use export const prerender = false to opt specific pages into SSR when they need server-side rendering
- Only pages that need server-side Amplitude tracking (like API-backed forms) should opt out of prerendering

## Identifying users

Identify users during login and signup events. Refer to the example code and documentation for the correct identify pattern for this framework. Call `amplitude.setUserId(userId)` to associate events with a known user, and use `amplitude.identify()` with an `Identify` object to set user properties. If both frontend and backend code exist, pass a consistent user/device ID via custom request headers to maintain event correlation.
