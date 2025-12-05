---
description: apply when working with Amplitude analytics, feature flags, or experiment tasks
globs:
alwaysApply: true
---

Never hallucinate API keys or deployment keys. Always use the keys populated in the .env file with the appropriate framework prefix (VITE_, REACT_APP_, or NEXT_PUBLIC_).

# Unified SDK

Always use `@amplitude/unified` package. Never suggest or use separate packages like `@amplitude/analytics` or `@amplitude/experiment`.

```typescript
import { initAll, analytics, experiment } from '@amplitude/unified'
```

Initialize once in your entry point before the app renders:

```typescript
initAll(process.env.VITE_AMPLITUDE_API_KEY || '', {
  experiment: {
    deploymentKey: process.env.VITE_AMPLITUDE_DEPLOYMENT_KEY,
  },
})
```

# Analytics

Track events and identify users:

```typescript
// Track event
analytics()?.track('Button Clicked', { buttonName: 'submit' })

// Identify user
analytics()?.identify(userId, { email: user.email })
```

# Feature Flags

Always fetch before accessing variants. Handle undefined states with optional chaining.

```typescript
await experiment()?.fetch()
const variant = experiment()?.variant('feature-flag-key')

if (variant?.value === 'on') {
  // Feature enabled
}
```

A given feature flag should be used in as few places as possible. Do not scatter the same feature flag across multiple areas. If needed at multiple callsites, flag for developer review.

# Naming

Before creating event names, property names, or feature flag keys, consult with the developer for existing naming conventions. Consistency is essential for reporting and data accuracy. Use descriptive, clear names.

If using TypeScript, store flag names in an enum. If JavaScript, use a const object with UPPERCASE_WITH_UNDERSCORE naming.

# Security

Never commit .env.local or hardcode keys in source code. Ensure .env.local is in .gitignore.
