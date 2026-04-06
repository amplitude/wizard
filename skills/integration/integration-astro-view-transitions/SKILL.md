---
name: integration-astro-view-transitions
description: Amplitude integration for Astro with ClientRouter view transitions
metadata:
  author: Amplitude
  version: 1.2.0
---

# Amplitude integration for Astro (View Transitions)

This skill helps you add Amplitude analytics to Astro (View Transitions) applications.

## Workflow

Follow these steps in order to complete the integration:

1. `basic-integration-1.0-begin.md` - Amplitude Setup - Begin ← **Start here**
2. `basic-integration-1.1-edit.md` - Amplitude Setup - Edit
3. `basic-integration-1.2-revise.md` - Amplitude Setup - Revise
4. `basic-integration-1.3-conclude.md` - Amplitude Setup - Conclusion

## Reference files

- `references/EXAMPLE.md` - Astro (View Transitions) example project code
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
- Wrap Amplitude initialization with a window.__amplitude_initialized guard to prevent re-initialization during soft navigation
- Use the astro page-load event instead of just DOMContentLoaded to re-run scripts after soft navigation

## Identifying users

Identify users during login and signup events. Refer to the example code and documentation for the correct identify pattern for this framework. Call `amplitude.setUserId(userId)` to associate events with a known user, and use `amplitude.identify()` with an `Identify` object to set user properties. If both frontend and backend code exist, pass a consistent user/device ID via custom request headers to maintain event correlation.
