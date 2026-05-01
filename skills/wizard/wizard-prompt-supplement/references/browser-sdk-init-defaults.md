# Browser SDK init defaults

Match Amplitude's recommended out-of-the-box coverage. **CRITICAL:** the CDN script and the npm packages do **NOT** share the same option shape — don't copy a CDN snippet's flat-options structure onto an npm `initAll` / `init` call.

## Authoritative sources (consult before any option, do not infer from CDN)

- https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2 (npm `@amplitude/analytics-browser`)
- https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk (npm `@amplitude/unified`)
- The bundled integration skill's `browser-sdk-2.md` / `browser-unified-sdk.md` mirror these (when present).

## npm Browser SDK 2 autocapture full set (use as default)

```json
{
  "attribution": true,
  "pageViews": true,
  "sessions": true,
  "formInteractions": true,
  "fileDownloads": true,
  "elementInteractions": true,
  "frustrationInteractions": true,
  "pageUrlEnrichment": true,
  "networkTracking": true,
  "webVitals": true
}
```

`frustrationInteractions`, `pageUrlEnrichment`, `networkTracking` require recent SDK versions — verify against installed package types or docs before relying on them. Don't invent option names.

**Remote config:** top-level `fetchRemoteConfig: true` is **DEPRECATED**. Use `remoteConfig: { fetchRemoteConfig: true }`.

## CRITICAL — inline comments

Every option in the generated init code must have an inline `// comment` on the same line briefly explaining what it does. Users tune behavior by reading these comments and commenting out lines they don't want — there's no checkbox UI.

Example:

```javascript
autocapture: {
  attribution: true,           // UTM / referrer attribution events
  pageViews: true,             // SPA route changes + initial load
  sessions: true,              // Session start / end events
  formInteractions: true,      // Form starts + submits
  fileDownloads: true,         // Downloads of common file types
  elementInteractions: true,   // Click + change on instrumented els
  frustrationInteractions: true, // Rage clicks, dead clicks
  pageUrlEnrichment: true,     // Adds path / search to event props
  networkTracking: true,       // XHR + fetch request events
  webVitals: true,             // CWV (LCP, INP, CLS) on page hide
},
```

## `@amplitude/analytics-browser` (standalone) — flat options

```javascript
init(API_KEY, {
  remoteConfig: { fetchRemoteConfig: true }, // remote SDK config from Amplitude
  autocapture: { /* full set with inline comments */ },
})
```

## `@amplitude/unified` (initAll) — analytics nested under `analytics`

```javascript
initAll(API_KEY, {
  analytics: {
    remoteConfig: { fetchRemoteConfig: true }, // remote SDK config
    autocapture: { /* full set with inline comments */ },
  },
  sessionReplay: { sampleRate: 1 }, // Record user sessions; comment out to disable
  engagement: {},                   // In-product Guides & Surveys; comment out to disable
})
```

Session Replay and Guides & Surveys are **AUTO-ENABLED** for unified browser projects. Don't gate on `sessionReplayOptIn` / `engagementOptIn` — those are always set when configuring a unified browser project. Users opt out by commenting lines in the generated init code.

## Do not use browser options on non-browser SDKs

These options are ONLY valid for the browser / unified SDK. Do NOT pass autocapture or any of these keys to:

- `@amplitude/analytics-node` (server) — accepts apiKey, optional serverZone ('US' | 'EU'), flushQueueSize, flushIntervalMillis. No autocapture.
- Mobile SDKs (`@amplitude/analytics-react-native` / `-android` / `-swift` / `-flutter`) — each has its own DefaultTrackingOptions / autocapture schema with platform-specific keys (`screenViews` on Swift, `appLifecycles` on Android, etc.). Follow the per-SDK README.
- Backend SDKs in other languages (Python, Java, Go, Ruby, .NET) — server-side, no autocapture surface.

When in doubt, consult the per-SDK README. Inventing an option name (or copying browser keys onto a non-browser SDK) causes runtime errors or silent no-ops. See https://amplitude.com/docs/sdks/client-side-vs-server-side for which SDK applies where.
