Amplitude's Browser SDK 2 lets you send events to Amplitude.

## Tip

To skip manual setup, use the [Amplitude Setup Wizard CLI](/docs/get-started/setup-wizard-cli). It reads your codebase, proposes tracking events, and instruments the SDK automatically with your approval.

## Install the SDK[](#install-the-sdk "Permalink")

Install the dependency with npm, yarn, or the script loader.

## Unified SDK

Install the [Browser Unified SDK](/docs/sdks/analytics/browser/browser-unified-sdk) to access the Experiment SDK along with other Amplitude products (Analytics, Session Replay). The Unified SDK provides a single entry point for all Amplitude features and simplifies the integration process by handling the initialization and configuration of all components.

## Initialize the SDK[](#initialize-the-sdk "Permalink")

## Load and initialize only when context is ready

Don't load the Amplitude SDK from third-party scripts that run before the page has fully loaded. In those setups, user identifiers, traits, and page URL or state often aren't available yet, so early events can be sent with missing or incorrect properties. Initialize the SDK only after your app has access to all relevant data (for example, user ID, user properties, and the final page URL).

## Sending events

This SDK uses the [HTTP V2](/docs/apis/analytics/http-v2) API and follows the same constraints for events. Make sure that all events logged in the SDK have the `event_type` field and at least one of `deviceId`  (included by default) or `userId`, and follow the HTTP API's constraints on each of those fields.

To prevent instrumentation issues, device IDs and user IDs must be strings with a length of 5 characters or more. If an event contains a device ID or user ID that's too short, the ID value is removed from the event. If the event doesn't have a `userId` or `deviceId` value, Amplitude may reject the upload with a 400 status. Override the default minimum length of 5 characters by setting the `minIdLength` config option.

This SDK requires initialization before you can instrument any events and requires your Amplitude project's API key. You can pass an optional `userID` and `config` object in this call.

```js
// Option 1, initialize with Amplitude API key only
amplitude.init(AMPLITUDE_API_KEY);

// Option 2, initialize with options
amplitude.init(AMPLITUDE_API_KEY, options);

// Option 3, initialize with user ID if it's already known
amplitude.init(AMPLITUDE_API_KEY, 'user@amplitude.com');

// Option 4, initialize with a user ID and options
amplitude.init(AMPLITUDE_API_KEY, 'user@amplitude.com', options);
```

## Warning

When using the SDK in an [Angular](https://angular.dev/) app with [Zone.js](https://angular.dev/api/core/NgZone), invoke `init` [outside of the Angular zone](https://angular.dev/api/core/NgZone#runOutsideAngular).

```javascript
runOutsideAngular(function () { amplitude.init(...args); })
```

The Angular zone overwrites certain DOM functions that, when invoked by [Amplitude autocapture](/docs/sdks/analytics/browser/browser-sdk-2#autocapture), causes some user interactions to break

## Next.js Integration

For detailed instructions on integrating Amplitude with Next.js applications, including both client-side and server-side setups, see the [Next.js Installation Guide](/docs/sdks/frameworks/nextjs-installation-guide).

## Configure the SDK[](#configure-the-sdk "Permalink")

### Configure batching behavior[](#configure-batching-behavior "Permalink")

To support high-performance environments, the SDK sends events in batches. The SDK queues in memory every event the `track` method logs. Customize this behavior with the `flushQueueSize` and `flushIntervalMillis` configuration parameters. If you plan to send large batches of data at once, set `useBatch` to `true` and `setServerUrl` to the batch API: `https://api2.amplitude.com/batch`. Both standard and batch modes use the same event upload threshold and flush time intervals

### EU data residency[](#eu-data-residency "Permalink")

To send data to Amplitude's EU-based servers, set the server zone when you initialize the client. If set, the SDK sends to the region determined by this setting.

```ts
amplitude.init(AMPLITUDE_API_KEY, {
  serverZone: 'EU',
});
```

## Data residency requirement

To send data to Amplitude's EU servers, your organization must use the EU data storage region, which you set during signup.

### Debugging[](#debugging "Permalink")

Control the level of logs the SDK prints to the console with the following `logLevel` settings:

Log level

Description

`none`

Suppresses all log messages

`error`

Shows error messages only

`warn`

Default. Shows error and warning messages.

`verbose`

Shows informative messages.

`debug`

Shows all messages, including function context information for each public method the SDK invokes. Amplitude recommends this log level for development only.

Set the `logLevel` parameter.

```ts
amplitude.init(AMPLITUDE_API_KEY, OPTIONAL_USER_ID, {
  logLevel: amplitude.Types.LogLevel.Warn,
});
```

## Note

In environments where you can't import the `LogLevel` enum (such as Google Tag Manager), use numeric values instead:

Numeric value

Log level

Enum equivalent

`0`

None

`LogLevel.None`

`1`

Error

`LogLevel.Error`

`2`

Warn

`LogLevel.Warn`

`3`

Verbose

`LogLevel.Verbose`

`4`

Debug

`LogLevel.Debug`

For example, to suppress all logs in GTM, set `logLevel` to `0`:

```js
// In GTM configuration
logLevel: 0
```

Don't use string values like `"LogLevel.None"` in GTM, as these won't work correctly.

The default logger outputs log to the developer console. You can provide your own logger implementation based on the `Logger` interface for any customization purpose. For example, collecting any error messages from the SDK in a production environment.

Set the logger by configuring the `loggerProvider` with your own implementation.

```ts
amplitude.init(AMPLITUDE_API_KEY, OPTIONAL_USER_ID, {
  loggerProvider: new MyLogger(),
});
```

#### Debug mode[](#debug-mode "Permalink")

Enable the debug mode by setting the `logLevel` to "Debug", for example:

```ts
amplitude.init(AMPLITUDE_API_KEY, OPTIONAL_USER_ID, {
  logLevel: amplitude.Types.LogLevel.Debug,
});
```

With the default logger, extra function context information is output to the developer console when invoking any SDK public method, including:

-   `type`: Category of this context, for example "invoke public method".
-   `name`: Name of invoked function, for example "track".
-   `args`: Arguments of the invoked function.
-   `stacktrace`: Stacktrace of the invoked function.
-   `time`: Start and end timestamp of the function invocation.
-   `states`: Useful internal states snapshot before and after the function invocation.

## Performance[](#performance "Permalink")

The Browser SDK 2 minimizes its impact on page performance through event batching, asynchronous processing, and optimizing bundle sizes.

### Bundle size[](#bundle-size "Permalink")

The Browser SDK 2 bundle size varies based on the installation method and features you use.

### [Package Information](https://npmjs.com/package/@amplitude/analytics-browser) Live

Package Name

`@amplitude/analytics-browser`

Version

2.42.0

Size (gzip)

57.15 kB

For the most up-to-date bundle size information, check the [npm package page](https://www.npmjs.com/package/@amplitude/analytics-browser) or [BundlePhobia](https://bundlephobia.com/package/@amplitude/analytics-browser).

### Runtime performance[](#runtime-performance "Permalink")

The Browser SDK 2 runs asynchronously and doesn't block the main thread during event tracking. Performance characteristics include:

-   **Event tracking**: Event tracking operations are non-blocking and typically complete in less than 1ms for each event.
-   **Network requests**: Events are batched and sent asynchronously, minimizing network overhead. The default configuration batches up to 30 events or sends every 1 second, whichever comes first.
-   **Memory usage**: The SDK maintains a small in-memory queue for event batching. Memory usage scales with the number of queued events (default: up to 30 events).
-   **CPU impact**: Event processing and batching operations have minimal CPU impact, typically less than 1% of CPU time during normal operation.

### Optimization tips[](#optimization-tips "Permalink")

To further optimize performance:

-   Adjust `flushQueueSize` and `flushIntervalMillis` to balance between network efficiency and memory usage.
-   Use the `offline` mode to defer event uploads when network conditions are poor.
-   Enable `useBatch` mode for high-volume event tracking to reduce the number of HTTP requests.

## Autocapture[](#autocapture "Permalink")

Starting in SDK version 2.10.0, the Browser SDK can autocapture events when you enable it, and adds a configuration to control the collection of autocaptured events. Browser SDK can autocapture the following event types:

-   Attribution
-   Page views
-   Sessions
-   Form interactions
-   File downloads
-   Element interactions
-   Page URL enrichment
-   Network tracking
-   Web vitals

### Remote configuration[](#remote-configuration "Permalink")

Autocapture supports [remote configuration](#remote-configuration). For more information, see [Autocapture Settings](/docs/data/amplitude-data-settings#autocapture).

### Disable Autocapture[](#disable-autocapture "Permalink")

To disable Autocapture, see the following code sample.

```ts
// Disable individual default tracked events
amplitude.init(AMPLITUDE_API_KEY, OPTIONAL_USER_ID, {
  autocapture: {
    attribution: false,
    pageViews: false,
    sessions: false,
    formInteractions: false,
    fileDownloads: false,
    elementInteractions: false,
    pageUrlEnrichment: false,
    webVitals: false,
  },
});

// Disable all default tracked events
amplitude.init(AMPLITUDE_API_KEY, OPTIONAL_USER_ID, {
  autocapture: false,
});
```

### Track marketing attribution[](#track-marketing-attribution "Permalink")

Amplitude tracks marketing attribution by default. Browser SDK 2 captures UTM parameters, referrer information, and click IDs.

You can choose how the SDK persists campaign attribution data:

-   **User property tracking** (default): Tracks campaign parameters as user properties through identify events for first-touch and multi-touch attribution.
-   **Event property tracking**: Attaches campaign parameters to each event's properties, giving you event-level attribution granularity. Use with [Persisted Properties](/docs/data/persisted-properties) to select different attribution models.

Set `config.autocapture.attribution` to `false` to disable marketing attribution tracking.

```ts
amplitude.init(AMPLITUDE_API_KEY, OPTIONAL_USER_ID, {
  autocapture: {
    attribution: false, 
  },
});
```

#### Advanced configuration for marketing attribution tracking[](#advanced-configuration-for-marketing-attribution-tracking "Permalink")

#### Event property tracking[](#event-property-tracking "Permalink")

## Version requirement

Event property attribution tracking requires Browser SDK version 2.40.0 or later.

Configure the SDK to attach campaign parameters to every event's properties instead of (or in addition to) user properties. This gives you event-level attribution granularity.

```ts
amplitude.init(AMPLITUDE_API_KEY, OPTIONAL_USER_ID, {
  autocapture: {
    attribution: {
      trackingMethod: 'eventProperty',
    },
  },
});
```

With event property tracking, the SDK:

-   Parses campaign parameters on page load and SPA navigations (History API changes like `pushState`, `replaceState`, `popstate`).
-   Attaches campaign fields to the `event_properties` of every tracked event.

## Note

Event property tracking doesn't set user properties. If you need both event-level attribution and user properties, enable both methods:

```ts
amplitude.init(AMPLITUDE_API_KEY, OPTIONAL_USER_ID, {
  autocapture: {
    attribution: {
      trackingMethod: ['userProperty', 'eventProperty'],
    },
  },
});
```

##### Fallback attribution event[](#fallback-attribution-event "Permalink")

When using event property tracking, enable `fallbackAttributionEvent` to ensure campaign data is captured even when users don't trigger other events. This fires an `[Amplitude] Attribution` event on each page view and SPA navigation.

```ts
amplitude.init(AMPLITUDE_API_KEY, OPTIONAL_USER_ID, {
  autocapture: {
    attribution: {
      trackingMethod: 'eventProperty',
      fallbackAttributionEvent: true,
    },
  },
});
```

##### Exclude internal referrers[](#exclude-internal-referrers "Permalink")

Use `excludeInternalReferrers` when you want to avoid attributing traffic to internal navigation (same domain or subdomain). The SDK treats a referrer as internal when `document.referrer` and `location.hostname` resolve to the same domain.

-   **Always exclude:** Set `excludeInternalReferrers: true` or `excludeInternalReferrers: { condition: 'always' }` to never track campaign information for internal referrers.
-   **Exclude only when campaign is empty:** Set `excludeInternalReferrers: { condition: 'ifEmptyCampaign' }` to skip campaign tracking for internal referrers where there are no UTM parameters or click IDs. If the user arrives from an internal page with UTM or click IDs, campaign data is still tracked (if the referrer isn't excluded by `excludeReferrers`)

##### Exclude referrers[](#exclude-referrers "Permalink")

## Note

All sub-configurations of `config.autocapture.attribution` take effect only on user properties and do **NOT** affect the event properties of the default page view events.

The default value of `config.autocapture.attribution.excludeReferrers` is the top level domain with cookie storage enabled. For example, if you initialize the SDK on `https://www.docs.developers.amplitude.com/`, the SDK first checks `amplitude.com`. If it doesn't allow cookie storage, then the SDK checks `developers.amplitude.com` and subsequent subdomains. If it allows cookie storage, then the SDK sets `excludeReferrers` to an RegExp object `/amplitude\.com$/` which matches and then exlucdes tracking referrers from all subdomains of `amplitude.com`, for example, `data.amplitude.com`, `analytics.amplitude.com` and etc.

In addition to excluding referrers from the default configuration, you can add other domains by setting the custom `excludeReferrers`. Custom `excludeReferrers` overrides the default values. For example, to also exclude referrers from `google.com`, set `excludeReferrers` to `[/amplitude\.com$/, 'google.com']`.

### Track page views[](#track-page-views "Permalink")

Amplitude tracks page view events by default. The default behavior sends a page view event on initialization. The event type for this event is `[Amplitude] Page Viewed`.

Set `config.autocapture.pageViews` to `false` to disable page view tracking.

```ts
amplitude.init(AMPLITUDE_API_KEY, OPTIONAL_USER_ID, {
  autocapture: {
    pageViews: false, 
  },
});
```

#### Advanced configuration for tracking page views[](#advanced-configuration-for-tracking-page-views "Permalink")

Use the advanced configuration to better control when the SDK sends page view events.

For example, you can configure Amplitude to track page views only when the URL path contains a certain substring.

```ts
amplitude.init(API_KEY, OPTIONAL_USER_ID, {
  autocapture: {
    pageViews: { 
      trackOn: () => {
        return window.location.pathname.includes('home');
      },
    },
  },
});
```

Browser SDK tracks the following information in page view events.

Name

Description

Default Value

`event_type`

`string`. The event type for page view event. Configurable through `autocapture.pageViews.eventType` or enrichment plugin.

`[Amplitude] Page Viewed` from version 1.9.1.

`event_properties.[Amplitude] Page Domain`

`string`. The page domain.

`location.hostname`or `''`.

`event_properties.[Amplitude] Page Location`

`string`. The page location.

`location.href` or `''`.

`event_properties.[Amplitude] Page Path`

`string`. The page path.

`location.path` or `''`.

`event_properties.[Amplitude] Page Title`

`string`. The page title.

`document.title` or `''`.

`event_properties.[Amplitude] Page URL`

`string`. The value of page URL.

`location.href.split('?')[0]` or `''`.

`event_properties.${CampaignParam}`

`string`. The value of `UTMParameters` `ReferrerParameters` `ClickIdParameters` if has any.

Any undefined `campaignParam` or `undefined`.

`event_properties.[Amplitude] Page Counter`

`integer`. The count of pages viewed in the session.

`1`

`event_properties.referrer`

`string`. The full URL of the users previous page.

`https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2`

`event_properties.referring_domain`

`string`. The domain of the page referrer. `amplitude.com`

Review [this example](https://github.com/amplitude/Amplitude-TypeScript/blob/main/examples/plugins/page-view-tracking-enrichment/index.ts) to understand how to enrich default page view events, such as adding more properties along with page view tracking.

## Warning

If you want Autocapture to include page views for multi-step forms that dynamically update and, therefore, don't refresh the URL with each step, you must use hash elements for Single Page Applications (SPAs). Autocapture doesn't capture the individual dynamic components automatically. Tools such as Google Tag Manager (GTM) can help you [apply hashes to the URL](https://support.google.com/tagmanager/answer/7679410?hl=en) of the SPA between steps. Autocapture can then ingest the different steps as users proceed through the form.

#### Page title masking[](#page-title-masking "Permalink")

Amplitude lets you to mask page titles in events that include the `[Amplitude] Page Title` property. This protects your sensitive page title information. Use the `data-amp-mask` attribute on your `<title>` element to exclude the actual page title from this property.

When the `<title>` element has the `data-amp-mask` attribute, Amplitude replaces the page title with a masked value across all events that capture page title information. For example:

```html
<head>
  <!-- This page title will be masked in all events that capture page titles -->
  <title data-amp-mask>John Doe - Personal Banking Dashboard</title>
</head>
```

```html
<head>
  <!-- Works with any attribute value -->
  <title data-amp-mask="true">Sensitive Customer Information</title>
</head>
```

## Page title masking behavior

-   Any presence of `data-amp-mask` triggers masking, regardless of the attribute value.
-   Only the page title text is masked. Events are tracked as expected.
-   This affects page view events, page URL enrichment events, and any other events that include `[Amplitude] Page Title`.
-   This is separate from [element interaction masking](/docs/data/autocapture#precise-text-masking) which uses `data-amp-mask` on individual elements
-   The masked value appears as `*****` in your event data

### Track sessions[](#track-sessions "Permalink")

Amplitude tracks session events by default. A session is the period of time a user has your website open. See [How Amplitude defines sessions](/docs/data/sources/instrument-track-sessions) for more information. When a new session starts, Amplitude tracks a session start event and is the first event of the session. The event type for session start is `[Amplitude] Start Session`. When an existing session ends, Amplitude tracks a session end event, which is the last event of the session. The event type for session end is `[Amplitude] End Session`.

You can opt out of tracking session events by setting `config.autocapture.sessions` to `false`. Refer to the code sample below.

```ts
amplitude.init(AMPLITUDE_API_KEY, OPTIONAL_USER_ID, {
  autocapture: {
    sessions: false, 
  },
});
```

### Track form interactions[](#track-form-interactions "Permalink")

Amplitude tracks form interaction events by default. The SDK tracks `[Amplitude] Form Started` when the user initially interacts with the form element. An initial interaction can be the first change to a text input, radio button, or dropdown. The SDK tracks a `[Amplitude] Form Submitted` when the user submits the form. If a user submits a form with no initial change to any form fields, Amplitude tracks both `[Amplitude] Form Started` and `[Amplitude] Form Submitted` events.

Amplitude can track forms constructed with `<form>` tags and `<input>` tags nested. For example:

```html
<form id="subscriber-form" name="subscriber-form" action="/subscribe">
  <input type="text" />
  <input type="submit" />
</form>
```

#### Disable form interaction tracking[](#disable-form-interaction-tracking "Permalink")

Set `config.autocapture.formInteractions` to `false` to disable form interaction tracking.

```ts
amplitude.init(AMPLITUDE_API_KEY, OPTIONAL_USER_ID, {
  autocapture: {
    formInteractions: false, 
  },
});
```

#### Control form submit tracking[](#control-form-submit-tracking "Permalink")

## Minimum SDK version

Minimum SDK version 2.34.0.

You can control when `[Amplitude] Form Submitted` events are tracked by passing a `FormInteractionsOptions` object with a `shouldTrackSubmit` callback.

By default, Amplitude tracks all form submit events. However, when a form has the [`novalidate`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement/noValidate) attribute set, the browser [submit event](https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement/submit_event) fires without performing default validation checks. This means the submit event triggers even if the form is empty or contains invalid data. In these cases, use `shouldTrackSubmit` to implement custom validation logic and control when Amplitude tracks the submit event.

The `shouldTrackSubmit` callback receives the form submit event and should return `true` to track the submit event or `false` to skip tracking.

```ts
amplitude.init(AMPLITUDE_API_KEY, OPTIONAL_USER_ID, {
  autocapture: {
    formInteractions: {
      shouldTrackSubmit: (event) => {
        // Only track submit if form is valid
        const form = event.target;
        return form.checkValidity();
      }
    }
  },
});
```

### Track file downloads[](#track-file-downloads "Permalink")

Amplitude tracks file download events by default. The SDK tracks `[Amplitude] File Downloaded` when the user clicks an anchor or `<a>` tag linked to a file. Amplitude determines that the anchor or `<a>` tag linked to a file if the file extension matches the following regex:

`pdf|xlsx?|docx?|txt|rtf|csv|exe|key|pp(s|t|tx)|7z|pkg|rar|gz|zip|avi|mov|mp4|mpe?g|wmv|midi?|mp3|wav|wma`

Set `config.autocapture.fileDownloads` to `false` to disable file download tracking.

```ts
amplitude.init(AMPLITUDE_API_KEY, OPTIONAL_USER_ID, {
  autocapture: {
    fileDownloads: false,
  },
});
```

### Track element interactions[](#track-element-interactions "Permalink")

You can enable element interaction tracking to capture clicks and changes for elements on your page, which is required for [Visual labeling](/docs/data/visual-labeling) and powers [Zoning](/docs/session-replay/zoning) for analyzing engagement within defined page areas. Review our page on [Autocapture privacy and security](/docs/data/autocapture#privacy-and-security) for more information about the data collected with these events.

Set `config.autocapture.elementInteractions` to `true` to enable element click and change tracking.

```ts
amplitude.init(AMPLITUDE_API_KEY, OPTIONAL_USER_ID, {
  autocapture: {
    elementInteractions: true, 
  },
});
```

#### Advanced configuration for element interactions[](#advanced-configuration-for-element-interactions "Permalink")

Use the advanced configuration to control element interaction tracking.

For example, you could configure Amplitude only to capture clicks on elements with a class of `amp-tracking` on the blog pages of a site as follows:

```ts
amplitude.init(API_KEY, OPTIONAL_USER_ID, {
  autocapture: {
    elementInteractions: {
      cssSelectorAllowlist: [
        '.amp-tracking'
      ],
      // When you use `cssSelectorAllowlist` to target specific elements, set `actionClickAllowlist`  [tl! ~~:2]
      // to ensure that Amplitude tracks interactions with non-standard clickable elements during page transitions or DOM updates.
      actionClickAllowlist: [],
      pageUrlAllowlist: [
        new RegExp('https://amplitude.com/blog/*')
      ]
    }
  }
});
```

By default, if you don't use these settings, Amplitude tracks the default selectors on all page on which you enable the plugin.

## Note

When you specify the CSS selectors to track, your selection overrides the default. To retain the default selectors import the `DEFAULT_CSS_SELECTOR_ALLOWLIST` and include it in your code.

```js
import { DEFAULT_CSS_SELECTOR_ALLOWLIST } from '@amplitude/plugin-autocapture-browser';

const selectors = [
  ...DEFAULT_CSS_SELECTOR_ALLOWLIST,
  '.class-of-a-thing-i-want-to-track',
];
```

### Track frustration interactions[](#track-frustration-interactions "Permalink")

Enable frustration interaction tracking to capture rage clicks and dead clicks. Amplitude defines "rage click" and  
"dead click" events as:

-   **Rage click**: A user clicks the same element, within 50px, four times in under a second.
-   **Dead click**: A user clicks an interactable element, but no navigation change happens and the DOM doesn't change.
-   **Error click**: A user clicks an element and a browser error occurs within two seconds of the click.
-   **Thrashed cursor**: A user's cursor moves rapidly back and forth within a short time window, indicating potential frustration.

Set `config.autocapture.frustrationInteractions` to `true` to enable capture of dead clicks and rage clicks.

Set `config.autocapture.frustrationInteractions.rageClicks` to `true` to enable capture of rage clicks.

Set `config.autocapture.frustrationInteractions.deadClicks` to `true` to enable capture of dead clicks.

Set `config.autocapture.frustrationInteractions.errorClicks` to `true` to enable capture of error clicks.

Set `config.autocapture.frustrationInteractions.thrashedCursor` to `true` to enable capture of thrashed cursors.

```ts
amplitude.init(AMPLITUDE_API_KEY, OPTIONAL_USER_ID, {
  autocapture: {
    frustrationInteractions: true, 
  },
});
```

#### Advanced configuration for frustration interactions[](#advanced-configuration-for-frustration-interactions "Permalink")

Use the advanced configuration to control frustration interaction tracking.

#### Track error clicks[](#track-error-clicks "Permalink")

Error click tracking captures when a user clicks an element and a browser error occurs within two seconds of the click. This helps you identify which user interactions may be triggering errors in your application.

Enable error click tracking:

```ts
amplitude.init(AMPLITUDE_API_KEY, OPTIONAL_USER_ID, {
  autocapture: {
    frustrationInteractions: {
      errorClicks: true,
    },
  },
});
```

When you enable error click tracking, it emits an event `[Amplitude] Error Click` that includes these properties:

-   `[Amplitude] Kind`: The type of error (one of uncaught exception, console error, unhandled promise rejection).
-   `[Amplitude] Message`: The error message.
-   `[Amplitude] Stack`: The error stack trace.
-   `[Amplitude] Filename`: The filename where the error occurred.
-   `[Amplitude] Line Number`: The line number where the error occurred.
-   `[Amplitude] Column Number`: The column number where the error occurred.
-   Element properties from the clicked element (for example, `[Amplitude] Element Text`, `[Amplitude] Element Tag Name`).

#### Track thrashed cursor[](#track-thrashed-cursor "Permalink")

Thrashed cursor tracking captures when a user's cursor moves rapidly back and forth with multiple direction changes within a short time window. This helps identify areas where users may be experiencing frustration or confusion.

Enable thrashed cursor tracking:

```ts
amplitude.init(AMPLITUDE_API_KEY, OPTIONAL_USER_ID, {
  autocapture: {
    frustrationInteractions: {
      thrashedCursor: true,
    },
  },
});
```

It emits an event called `[Amplitude] Thrashed Cursor`

### Track network requests[](#track-network-requests "Permalink")

Track when network requests fail (only XHR and fetch). By default, tracks network requests with a response code in the range `500-599`, excluding requests made to any `amplitude.com` domain.

Set `config.autocapture.networkTracking` to `true` to enable network request tracking

```ts
amplitude.init(AMPLITUDE_API_KEY, OPTIONAL_USER_ID, {
  autocapture: {
    networkTracking: true, 
  },
});
```

When you enable this setting, Amplitude tracks the `[Amplitude] Network Request` event whenever the application makes a network request.

#### Advanced configuration for network tracking[](#advanced-configuration-for-network-tracking "Permalink")

Set `config.autocapture.networkTracking` to a `NetworkTrackingOptions` object to configure which network requests get tracked.

```ts
amplitude.init(AMPLITUDE_API_KEY, OPTIONAL_USER_ID, {
  autocapture: {
    networkTracking: {
      captureRules: [
        {
          statusCodeRange: "400-599"
        }
      ],
      ignoreHosts: ["*.example.com"],
      ignoreAmplitudeRequests: true
    }
  },
});
```

This example tracks network requests with status codes from 400-599, ignores requests to `*.example.com` domains, and excludes Amplitude's own requests. Review the configuration options below for more details.

#### Safe headers[](#safe-headers "Permalink")

When you set `requestHeaders: true` or `responseHeaders: true`, Amplitude captures only safe headers and excludes sensitive ones that may contain authentication credentials or personally identifiable information.

#### Network body capture[](#network-body-capture "Permalink")

If a network request or response body is in JSON, you can capture part of the response body by configuring `responseBody.allowlist` and `responseBody.blocklist`. You can capture part of the request body by configuring `requestBody.allowlist` and `requestBody.blocklist`.

The allowlist and blocklist are lists of JSON Pointer-like strings that capture specific fields. (For example: `['foo/bar', 'hello/**']`). `allowlist` tells the client which fields to capture. `excludelist` tells the client to exclude fields from capture (by default, nothing captured)

Example request/response body

```json
{
  "a": "A",
  "b": {
    "c": "C",
    "d": {
      "e": "E",
      "f": "F"
    }
  },
  "g": "G"
}
```

allowlist

Captured Result

`a`

`{ "a": "A" }`

`a/b/*`

`{ "a": { "b": { "c": "C" } } }`

`b/c`

`{ "b": { "c": "C" } }`

`b/**`

`{ "b": { "c": "C", "d": { "e": "E", "f": "F" } } }`

`b/d/*`

`{ "b": { "d": { "e": "E", "f": "F" } } }`

`b/**`

`{ "b": { "c": "C", "d": { "e": "E", "f": "F" } }`

`*`

`{ "a": "A", "g": "G" }`

### Track web vitals[](#track-web-vitals "Permalink")

Track Core Web Vitals performance metrics automatically. When enabled, Amplitude captures web performance metrics and sends them as `[Amplitude] Web Vitals` events when the browser tab first becomes hidden (when users navigate away, close the tab, or switch tabs).

## Note

Requires Browser SDK 2.27.0 or higher.

Set `config.autocapture.webVitals` to `true` to enable web vitals tracking:

```ts
amplitude.init(AMPLITUDE_API_KEY, OPTIONAL_USER_ID, {
  autocapture: {
    webVitals: true, //[tl! highlight]
  },
});
```

#### Metrics captured[](#metrics-captured "Permalink")

The web vitals autocapture feature captures the following Core Web Vitals metrics

-   [INP](https://web.dev/articles/inp)
-   [TTFB](https://web.dev/articles/ttfb)
-   [LCP](https://web.dev/articles/lcp)
-   [FCP](https://web.dev/articles/fcp)
-   [CLS](https://web.dev/articles/cls)

#### Event properties[](#event-properties "Permalink")

The `[Amplitude] Web Vitals` event includes the following properties:

Property

Description

`[Amplitude] Page Domain`

The hostname of the current page

`[Amplitude] Page Location`

The full URL of the current page

`[Amplitude] Page Path`

The pathname of the current page

`[Amplitude] Page Title`

The title of the current page

`[Amplitude] Page URL`

The URL of the current page without query parameters

`[Amplitude] LCP`

[Largest Contentful Paint](https://github.com/GoogleChrome/web-vitals?tab=readme-ov-file#lcpmetric) (if available)

`[Amplitude] FCP`

[First Contentful Paint](https://github.com/GoogleChrome/web-vitals?tab=readme-ov-file#fcpmetric) (if available)

`[Amplitude] INP`

[Interaction to Next Paint](https://github.com/GoogleChrome/web-vitals?tab=readme-ov-file#inpmetric) (if available)

`[Amplitude] CLS`

[Cumulative Layout Shift](https://github.com/GoogleChrome/web-vitals?tab=readme-ov-file#clsmetric) (if available)

`[Amplitude] TTFB`

[Time to First Byte](https://github.com/GoogleChrome/web-vitals?tab=readme-ov-file#ttfbmetric) (if available)

## Track an event[](#track-an-event "Permalink")

Events represent how users interact with your application. For example, the Button Clicked event might be an action you want to track.

```ts
// Track a basic event.
amplitude.track('Button Clicked');

// Track events with optional properties.
const eventProperties = {
  buttonColor: 'primary',
};
amplitude.track('Button Clicked', eventProperties);
```

You can also pass a `BaseEvent` object to `track`. For more information, review the [BaseEvent](https://amplitude.github.io/Amplitude-TypeScript/interfaces/_amplitude_analytics_browser.Types.BaseEvent.html) interface for all available fields.

```ts
const event_properties = {
  buttonColor: 'primary',
};

const event = {
  event_type: "Button Clicked", 
  event_properties,
  groups: { 'role': 'engineering' },
  group_properties: { 'groupPropertyKey': 'groupPropertyValue' }
};

amplitude.track(event);
```

## Track events to multiple projects[](#track-events-to-multiple-projects "Permalink")

By default, Amplitude SDKs send data to one Amplitude project. To send data to more than one project, add an instance of the Amplitude SDK for each project you want to receive data. Then, pass instance variables to wherever you want to call Amplitude. Each instance allows for independent `apiKey`, `userId`, `deviceId`, and `settings` values.

```ts
const defaultInstance = amplitude.createInstance();
defaultInstance.init(API_KEY_DEFAULT);

const envInstance = amplitude.createInstance();
envInstance.init(API_KEY_ENV, {
  instanceName: 'env',
});
```

## User properties[](#user-properties "Permalink")

User properties are details like device details, user preferences, or language to help you understand your users at the time they performed an action in your app.

Identify is for setting the user properties of a particular user without sending any event. The SDK supports the operations `set`, `setOnce`, `unset`, `add`, `append`, `prepend`, `preInsert`, `postInsert`, `remove`, and `clearAll` on individual user properties. Declare the operations through a provided Identify interface. You can chain together multiple operations in a single Identify object. The Identify object is then passed to the Amplitude client to send to the server.

## Identify calls

If the SDK sends the Identify call after the event, the details of the call appear immediately in the user's profile in Amplitude. Results don't appear in chart results until the SDK sends another event after Identify. Identify calls affect events that happen after it. For more information, see [Overview of user properties and event properties](/docs/data/user-properties-and-events).

### Set a user property[](#set-a-user-property "Permalink")

The Identify object provides controls for setting user properties. To set a user property:

1.  Instantiate an Identify object
2.  Call methods on that object
3.  Instruct the SDK to make a call with the Identify object

```ts
const identifyEvent = new amplitude.Identify();
// Use methods in the following sections to update the Identify object
amplitude.identify(identifyEvent);
```

#### Identify.set[](#identifyset "Permalink")

This method sets the value of a user property. For example, you can set a role property of a user.

```ts
const identifyEvent = new amplitude.Identify();
identifyEvent.set('location', 'LA'); 
amplitude.identify(identifyEvent);
```

#### Identify.setOnce[](#identifysetonce "Permalink")

This method sets the value of a user property only one time. Subsequent calls using `setOnce()` are ignored. For example, you can set an initial login method for a user. `setOnce()` ignores later calls.

```ts
const identifyEvent = new amplitude.Identify();
identifyEvent.setOnce('initial-location', 'SF'); 
identify(identifyEvent);
```

#### Identify.add[](#identifyadd "Permalink")

This method increments a user property by a numerical value. If the user property doesn't have a value set yet, it's initialized to `0` before it's incremented. For example, you can track a user's travel count.

```ts
const identifyEvent = new amplitude.Identify();
identifyEvent.add('travel-count', 1); 
amplitude.identify(identifyEvent);
```

#### Identify.unset[](#identifyunset "Permalink")

This method removes a user property from a user profile. Use `unset` when you no longer need a property or want to remove it completely.

```ts
const identifyEvent = new amplitude.Identify();
identifyEvent.unset('location'); 
amplitude.identify(identifyEvent);
```

### Arrays in user properties[](#arrays-in-user-properties "Permalink")

Call the `prepend`, `append`, `preInsert`, or `postInsert` methods to use arrays as user properties.

#### Identify.prepend[](#identifyprepend "Permalink")

This method prepends a value or values to a user property array. If the user property doesn't have a value set yet, it's initialized to an empty list before the new values are prepended.

```ts
const identifyEvent = new Identify();
identifyEvent.prepend('visited-locations', 'LAX'); 
identify(identifyEvent);
```

#### Identify.append[](#identifyappend "Permalink")

This method appends a value or values to a user property array. If the user property doesn't have a value set yet, it's initialized to an empty list before the new values are prepended.

```ts
const identifyEvent = new amplitude.Identify();
identifyEvent.append('visited-locations', 'SFO'); 
amplitude.identify(identifyEvent);
```

#### Identify.postInsert[](#identifypostinsert "Permalink")

This method post-inserts a value or values to a user property if it doesn't exist in the user property yet. Post-insert means inserting the values at the end of a given list. If the user property doesn't have a value set yet, it's initialized to an empty list before the new values are post-inserted. If the user property has an existing value, this method is a no-op.

```ts
const identifyEvent = new amplitude.Identify();
identifyEvent.postInsert('unique-locations', 'SFO'); 
amplitude.identify(identifyEvent);
```

#### Identify.remove[](#identifyremove "Permalink")

This method removes a value or values to a user property if it exists in the user property. Remove means remove the existing values from the given list. If the user property has an existing value, this method is a no-op.

```ts
const identifyEvent = new amplitude.Identify();
identifyEvent.remove('unique-locations', 'JFK') 
amplitude.identify(identifyEvent);
```

#### Identify.clearAll[](#identifyclearall "Permalink")

This method removes all user properties from the user. Use `clearAll` with care because it's irreversible.

```ts
const identifyEvent = new amplitude.Identify();
identifyEvent.clearAll();
amplitude.identify(identifyEvent);
```

## User groups[](#user-groups "Permalink")

Amplitude supports assigning users to groups and performing queries, such as Count by Distinct, on those groups. If at least one member of the group has performed the specific event, then the count includes the group.

For example, you want to group your users based on what organization they're in by using an 'orgId'. Joe is in 'orgId' '10', and Sue is in 'orgId' '15'. Sue and Joe both perform a certain event. You can query their organizations in the Event Segmentation Chart.

When setting groups, define a `groupType` and `groupName`. In the previous example, 'orgId' is the `groupType` and '10' and '15' are the values for `groupName`. Another example of a `groupType` could be 'sport' with `groupName` values like 'tennis' and 'baseball'.

Setting a group also sets the `groupType:groupName` as a user property, and overwrites any existing `groupName` value set for that user's `groupType`, and the corresponding user property value. `groupType` is a string, and `groupName` can be either a string or an array of strings to tell that a user is in multiple groups.

## Example

If Joe is in 'orgId' '15', then the `groupName` is `15`.

```ts
// set group with a single group name
amplitude.setGroup('orgId', '15');
```

If Joe is in 'sport' 'soccer' and 'tennis', then the `groupName` is `["tennis", "soccer"]`.

```ts
// set group with multiple group names
amplitude.setGroup('sport', ['soccer', 'tennis']);
```

Pass an `Event` object with `groups` to a Track call to set an **event-level group**. With event-level groups, the group designation applies only to the specific logged event, and doesn't persist to the user unless you explicitly set it with `setGroup`.

```ts
amplitude.track({
  event_type: 'event type',
  event_properties: { eventPropertyKey: 'event property value' },
  groups: { 'orgId': '15' }
})
```

## Group properties[](#group-properties "Permalink")

Use the Group Identify API to set or update the properties of particular groups. These updates only affect events going forward.

The `groupIdentify()` method accepts a group type and group name string parameter, as well as an Identify object that's applied to the group.

```ts
const groupType = 'plan';
const groupName = 'enterprise';
const groupIdentifyEvent = new amplitude.Identify()
groupIdentifyEvent.set('key1', 'value1');
amplitude.groupIdentify(groupType, groupName, groupIdentifyEvent); 
```

## Track revenue[](#track-revenue "Permalink")

The preferred method of tracking revenue for a user is to use `revenue()` in conjunction with the provided Revenue interface. Revenue instances store each revenue transaction and allow you to define several special revenue properties (like `revenueType` and `productId`) that are used in Amplitude's Event Segmentation and Revenue LTV charts. These Revenue instance objects are then passed into `revenue()` to send as revenue events to Amplitude. This lets Amplitude automatically display data relevant to revenue in the platform. You can use this to track both in-app and non-in-app purchases.

## Tip

Amplitude recommends to also enable [product array](/docs/analytics/charts/cart-analysis) tracking method to get the most information possible.

To track revenue from a user, call revenue each time a user generates revenue. In this example, the user purchased 3 units of a product at $3.99.

```ts
const event = new amplitude.Revenue()
  .setProductId('com.company.productId')
  .setPrice(3.99)
  .setQuantity(3)
  .setRevenueType('purchase');

amplitude.revenue(event);
```

This example shows tracking revenue with currency type:

```ts
const event = new amplitude.Revenue()
  .setProductId('com.company.productId')
  .setPrice(3.99)
  .setQuantity(3)
  .setRevenueType('purchase')
  .setCurrency('JPY');

amplitude.revenue(event);
```

This example shows tracking revenue with additional properties:

```ts
const event = new amplitude.Revenue()
  .setProductId('com.company.productId')
  .setPrice(3.99)
  .setQuantity(3)
  .setRevenueType('purchase')
  .setEventProperties({
    category: 'electronics',
    brand: 'Acme'
  });

amplitude.revenue(event);
```

### Revenue interface[](#revenue-interface "Permalink")

Revenue objects support the following properties. Use the corresponding setter methods to assign values.

Name

Setter Method

Description

Default Value

`productId`

`setProductId()`

Optional. `string`. An identifier for the product. Amplitude recommends something like the Google Play Store product ID.

Empty string.

`quantity`

`setQuantity()`

Required. `number`. The quantity of products purchased. `revenue = quantity * price`.

`1`

`price`

`setPrice()`

Required. `number`. The price of the products purchased, and this can be negative. `revenue = quantity * price`.

`null`

`revenueType`

`setRevenueType()`

Optional, but required for revenue verification. `string`. The revenue type (for example, tax, refund, income).

`null`

`currency`

`setCurrency()`

Optional. `string`. The currency type for the revenue (for example, `'USD'`, `'JPY'`, `'EUR'`).

`null`

`receipt`

`setReceipt()`

Optional. `string`. The receipt identifier of the revenue.

`null`

`receiptSignature`

`setReceiptSignature()`

Optional, but required for revenue verification. `string`. The receipt signature of the revenue.

`null`

`eventProperties`

`setEventProperties()`

Optional. `{ [key: string]: any }`. An object of event properties to include in the revenue event.

`null`

## Flush the event buffer[](#flush-the-event-buffer "Permalink")

The `flush` method triggers the client to send buffered events immediately.

```ts
amplitude.flush();
```

By default, Browser SDK calls`flush` automatically at an interval. If you want to flush all events, control the async flow with the optional Promise interface, for example:

```ts
amplitude.init(API\_KEY).promise.then(function() {
  amplitude.track('Button Clicked');
  amplitude.flush();
});
```

## Custom user identifier[](#custom-user-identifier "Permalink")

If your application has a login system that you want to track users with, call `setUserId` to update the user's identifier.

```ts
amplitude.setUserId('user@amplitude.com');
```

## Custom session identifier[](#custom-session-identifier "Permalink")

Assign a new session ID with `setSessionId`. When you set a custom session ID, make sure the value is in milliseconds since epoch (Unix Timestamp).

```ts
amplitude.setSessionId(Date.now());
```

## Custom device identifier[](#custom-device-identifier "Permalink")

Assign a new device ID with `deviceId`. When you set a custom device ID, make sure the value is sufficiently unique. Amplitude recommends using a UUID.

```ts
amplitude.setDeviceId(uuid());
```

## Reset when the user logs out[](#reset-when-the-user-logs-out "Permalink")

Use `reset` as a shortcut to anonymize users after they log out. `reset` does the following:

1.  Sets `userId` to `undefined`.
2.  Sets `deviceId` to a new UUID value.

With an undefined `userId` and a new `deviceId`, the user appears to Amplitude as a new user.

```ts
amplitude.reset();
```

## Opt users out of tracking[](#opt-users-out-of-tracking "Permalink")

Set `setOptOut` to `true` to disable logging for a specific user.

```ts
amplitude.setOptOut(true);
```

Amplitude doesn't save or send events to the server while `setOptOut` is enabled. The setting persists across page loads.

Set `setOptOut` to `false` to re-enable logging.

```ts
amplitude.setOptOut(false);
```

## Optional tracking[](#optional-tracking "Permalink")

By default, the SDK tracks these properties automatically. You can override this behavior by passing a configuration called `trackingOptions` when initializing the SDK, setting the appropriate options to false.

Tracking Options

Default

`ipAddress`

`true`

`language`

`true`

`platform`

`true`

```ts
amplitude.init(AMPLITUDE_API_KEY, {
  trackingOptions: {
    ipAddress: false,
    language: false,
    platform: false,
  },
});
```

## Callback[](#callback "Permalink")

All asynchronous APIs are optionally awaitable through a Promise interface. This also serves as a callback interface.

## Plugins[](#plugins "Permalink")

Plugins allow you to extend Amplitude SDK's behavior by, for example, modifying event properties (enrichment plugin) or sending to third-party endpoints (destination plugin). A plugin is an `Object` with optional fields `name` and `type` and methods `setup()`, `execute()` and `teardown()`.

### add[](#add "Permalink")

The `add` method adds a plugin to Amplitude.

```ts
amplitude.add(new Plugin());
```

### remove[](#remove "Permalink")

The `remove` method removes the given plugin name from the client instance if it exists.

```ts
amplitude.remove(plugin.name);
```

### Create a custom plugin[](#create-a-custom-plugin "Permalink")

Field / Function

Description

`plugin.name`

Optional. The name field is an optional property that allows you to reference the plugin for deletion purposes. If not provided, Amplitude assigns a random name when you add the plugin. If you don't plan to delete your plugin, you can skip assigning a name.

`plugin.type`

Optional. The type field is an optional property that defines the type of plugin you are creating. See `plugin.execute()` function below to distinguish the two types. If not defined, the plugin defaults to an enrichment type.

`plugin.setup()`

Optional. The setup function is an optional method called when you add the plugin or on first init whichever happens later. This function accepts two parameters: 1) Amplitude configuration; and 2) Amplitude instance. This is useful for setup operations and tasks that depend on either the Amplitude configuration or instance. Examples include assigning baseline values to variables, setting up event listeners, and many more.

`plugin.execute()`

Optional for type:enrichment. For enrichment plugins, execute function is an optional method called on each event. This function must return a new event, otherwise, the SDK drops the passed event from the queue. This is useful for cases where you need to add/remove properties from events, filter events, or perform any operation for each event tracked.  
  
For destination plugins, execute function is a required method called on each event. This function must return a response object with keys: `event` (BaseEvent), `code` (number), and `message` (string). This is useful for sending events for third-party endpoints.

`plugin.teardown()`

Optional. The teardown function is an optional method called when Amplitude re-initializes. This is useful for resetting unneeded persistent state created/set by setup or execute methods. Examples include removing event listeners or mutation observers.

### Plugin examples[](#plugin-examples "Permalink")

### Available plugins[](#available-plugins "Permalink")

Amplitude provides several official plugins to extend the Browser SDK functionality:

#### Page URL enrichment plugin[](#page-url-enrichment-plugin "Permalink")

The [page URL enrichment plugin](/docs/sdks/analytics/browser/page-url-enrichment-plugin) is enabled by default with autocapture. It automatically adds page URL-related properties to all events, including current page information, previous page location, and page type classification.

To disable page URL enrichment, set `autocapture.pageUrlEnrichment` to `false`:

```ts
amplitude.init(API_KEY, {
  autocapture: {
    pageUrlEnrichment: false,
  },
});
```

For custom configuration or if you disabled autocapture entirely, you can still add the plugin manually:

```ts
import { pageUrlEnrichmentPlugin } from '@amplitude/plugin-page-url-enrichment-browser';

const pageUrlEnrichment = pageUrlEnrichmentPlugin();
amplitude.add(pageUrlEnrichment);
amplitude.init(API_KEY);
```

## Troubleshooting and debugging[](#troubleshooting-and-debugging "Permalink")

Debugging in a browser can help you identify problems related to your code's implementation, as well as potential issues within the SDKs you're using. Here's a basic guide on how to use the browser's built-in Developer Tools (DevTools) for debugging.

### Console[](#console "Permalink")

You can find JavaScript errors under **Inspect > Console**, which might have the details about the line of code and file that caused the problem. The console also allows you to execute JavaScript code in real time.

-   Enable debug mode by following these [instructions](#debugging). Then With the default logger, extra function context information will be output to the developer console when any SDK public method is invoked, which can be helpful for debugging.
    
-   Amplitude supports SDK deferred initialization. Events tracked before initialization will be dispatched after the initialization call. If you cannot send events but can send the event successfully after entering `amplitude.init(API_KEY, 'USER_ID')` in the browser console, it indicates that your `amplitude.init` call might not have been triggered in your codebase or you aren't using the correct Amplitude instance during initialization. Therefore, check your implementation."
    

### Network Request[](#network-request "Permalink")

Use the **Inspect > Network** tab to view all network requests made by your page. Search for the Amplitude request.

Check the response code and ensure that the response payload is as expected.

### Instrumentation Explorer/Chrome Extension[](#instrumentation-explorerchrome-extension "Permalink")

The Amplitude Instrumentation Explorer is an extension available in the Google Chrome Web Store. The extension captures each Amplitude event you trigger and displays it in the extension popup. It's important to ensure that the event has been sent out successfully and to check the context in the event payload.

### Common Issues[](#common-issues "Permalink")

The following are common issues specific to Browser SDK. For more general common issues, see [SDK Troubleshooting and Debugging](/docs/sdks/sdk-debugging).

#### Ad blocker[](#ad-blocker "Permalink")

`Ad Blocker` might lead to event dropping. The following errors indicate that the tracking has been affected by `Ad Blocker`. When loading through a script tag, an error may appear in the console/network tab while loading the SDK script. When loaded with npm package, there could be errors in the network tab when trying to send events to the server. The errors might vary depending on the browser.

-   Chrome (Ubuntu, MacOS)  
    Console: error net::ERR\_BLOCKED\_BY\_CLIENT  
    Network: status (blocked:other)
-   Firefox (Ubuntu)  
    Console: error text doesn’t contain any blocking-specific info  
    Network: Transferred column contains the name of plugin Blocked by uBlock Origin
-   Safari (MacOS)  
    Console: error contains text Content Blocker prevented frame ... from loading a resource from ...  
    Network: it looks like blocked requests aren't listed. Not sure if it’s possible to show them.

Amplitude recommends using a proxy server to avoid this situation.

#### Cookies related[](#cookies-related "Permalink")

Here is the [information](#cookie-management) SDK stored in the cookies. This means that client behavior, like disabling cookies or using a private browser/window/tab, will affect the persistence of these saved values in the cookies. If these values aren't persistent or aren't increasing by one, that could be the reason.

#### CORS[](#cors "Permalink")

Cross-Origin Resource Sharing (CORS) is a security measure implemented by browsers to restrict how resources on a web page can be requested from a different domain. It might cause this issue if you used `setServerURL`.

`Access to fetch at 'xxx' from origin 'xxx' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource. If an opaque response serves your needs, set the request's mode to 'no-cors' to fetch the resource with CORS disabled.`

Cross-origin resource sharing (CORS) prevents a malicious site from reading another site's data without permission. The error message suggests that the server you're trying to access isn't allowing your origin to access the requested resource. This is due to the lack of the `Access-Control-Allow-Origin` header in the server's response.

-   If you have control over the server, you can "Update the server's CORS policy". Add the `Access-Control-Allow-Origin` header to the server's responses. This would allow your origin to make requests. The value of `Access-Control-Allow-Origin` can be \* to allow all origins, or it can be the specific URL of your web page.
    
-   If you don't have control over the server, you can set up a proxy server that adds the necessary CORS headers. The web page makes requests to the proxy, which then makes requests to the actual server. The proxy adds the `Access-Control-Allow-Origin` header to the response before sending it back to the web page.
    

If you have set up an API proxy and run into configuration issues related to that on a platform you’ve selected, that’s no longer an SDK issue but an integration issue between your application and the service provider.

#### Events fired but no network requests[](#events-fired-but-no-network-requests "Permalink")

If you [set the logger to "Debug" level](#debugging), and see track calls in the developer console, the `track()` method has been called. If you don't see the corresponding event in Amplitude, the Amplitude Instrumentation Explorer Chrome extension, or the network request tab of the browser, the event wasn't sent to Amplitude. Events are fired and placed in the SDK's internal queue upon a successful `track()` call, but sometimes these queued events may not send successfully. This can happen when an in-progress HTTP request is cancelled. For example, if you close the browser or leave the page.

There are two ways to address this issue:

1.  If you use standard network requests, set the transport to `beacon` during initialization or set the transport to `beacon` upon page exit. `sendBeacon` doesn't work in this case because it sends events in the background, and doesn't return server responses like `4xx` or `5xx`. As a result, it doesn't retry on failure. `sendBeacon` sends only scheduled requests in the background. For more information, see the [sendBeacon](#use-sendbeacon) section.
    
2.  To make track() synchronous, [add the `await` keyword](#callback) before the call.
    

## Advanced topics[](#advanced-topics "Permalink")

### Cross-domain tracking[](#cross-domain-tracking "Permalink")

You can track anonymous behavior across two different domains. Amplitude identifies anonymous users by their device IDs which must be passed between the domains. To maintain the same session and ensure a continuous user journey, also pass session IDs to the other domain.

## Note

Starting from `v2.8.0` the SDK supports getting the device ID from the URL parameter `ampDeviceId`. The SDK configuration, for example, `init('API_KEY', { deviceId: 'custom-device-id' })` still takes precedence over the URL parameter. Previous versions of the SDK supported the `deviceId` URL parameter, this option is still supported for backward compatibility but `ampDeviceId` will take precedence if both are set. You don't need to change your code if upgrade to versions higher than `v2.8.0` but it is recommended.

For example:

-   Site 1: `www.example.com`
-   Site 2: `www.example.org`

Users who start on Site 1 and then navigate to Site 2 must have the device ID generated from Site 1 passed as a parameter to Site 2. Site 2 then needs to initialize the SDK with the device ID.  
The SDK can parse the URL parameter automatically if `deviceId` is in the URL query parameters.

Starting from `v2.8.0`, the SDK can automatically get session ID from the URL to keep the same session and ensure a continuous user journey.

1.  From Site 1, grab the device ID from `getDeviceId()` and the session ID from `getSessionId()`.
2.  Pass the device ID and session ID to Site 2 through a URL parameter when the user navigates. (for example: `www.example.com?ampDeviceId=device_id_from_site_1&ampSessionId=1716245958483`)
3.  Initialize the Amplitude SDK on Site 2 with `init('API_KEY', null)`.

If the `deviceId` and `sessionId` aren't set in `init('API_KEY', null, { deviceId: 'custom-device-id', sessionId: 1716245958483 })`, the SDK automatically falls back to using the URL parameters respectively.

#### Evaluation window with ampTimestamp[](#evaluation-window-with-amptimestamp "Permalink")

## Note

This feature requires @amplitude/analytics-browser@2.21.1 and above.

To improve security and prevent the use of stale session or device IDs, you can include an `ampTimestamp` parameter that acts as an evaluation window. The SDK only uses `ampSessionId` and `ampDeviceId` URL parameters if the `ampTimestamp` value is in the future (greater than the current time).

For example:

```
www.example.com?ampDeviceId=device_id&ampSessionId=session_id&ampTimestamp=1640995500000
```

When `ampTimestamp` expires (is less than the current time), the SDK ignores the `ampSessionId` and `ampDeviceId` parameters. It falls back to generating new values or using stored values from cookies. If `ampTimestamp` isn't provided, the SDK behaves as before for backward compatibility.

This feature ensures that cross-domain tracking parameters remain valid only for a limited time window. This prevents potential security issues from long-lived URLs with embedded tracking parameters.

Amplitude recommends that you follow the same session ID format as the Browser SDK using `Date.now()` because the SDK checks if an event is in session every time it tracks an event. For example:

```typescript
// if session ID is set to 12345
// https://www.example.com?ampDeviceId=my-device-id&ampSessionId=12345
amplitude.init(API_KEY)
// session ID is set to 12345 after init()

amplitude.track("event")
// session ID is set back to Date.now() 
// because the tracked "event" is not in the previous session 12345
```

### Custom HTTP request headers[](#custom-http-request-headers "Permalink")

Use the `transport` configuration option to attach custom HTTP headers to event upload requests. Instead of passing a transport name string, pass an object with `transport` and `headers` properties. This is useful for scenarios like routing requests through a proxy server that requires specific headers.

## Note

Custom headers only work with `fetch` and `xhr` transports. When using the `beacon` transport, the browser doesn't support custom headers due to limitations of the [sendBeacon API](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon).

```ts
amplitude.init(API_KEY, {
  transport: {
    type: 'fetch',
    headers: {
      'X-Custom-Header': 'custom-value',
      'Authorization': 'Bearer your-token',
    },
  },
});
```

You can also use the `xhr` transport with custom headers:

```ts
amplitude.init(API_KEY, {
  transport: {
    type: 'xhr',
    headers: {
      'X-Custom-Header': 'custom-value',
    },
  },
});
```

### Request body compression[](#request-body-compression "Permalink")

The Browser SDK supports gzip compression for event upload request bodies to reduce bandwidth usage and improve upload performance. Compression is especially beneficial when sending large batches of events.

#### How compression works[](#how-compression-works "Permalink")

The SDK automatically compresses request bodies when:

-   The payload size is 2KB or larger.
-   The browser supports the `CompressionStream` API (available in modern browsers).
-   The transport type is `fetch` or `xhr` (compression isn't supported with the `beacon` transport).

When using Amplitude's default ingestion endpoints (`https://api2.amplitude.com`), compression is automatically enabled. When using a custom `serverUrl` (for example, a proxy server), you must explicitly enable compression by setting `enableRequestBodyCompression` to `true`.

## Note

The `beacon` transport doesn't support compression because the [sendBeacon API](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon) doesn't allow setting custom headers, which are required for gzip compression.

#### Enable compression for custom servers[](#enable-compression-for-custom-servers "Permalink")

If you route events through a custom proxy server, enable compression by setting `enableRequestBodyCompression` to `true`:

```ts
amplitude.init(API_KEY, {
  serverUrl: 'https://your-proxy.example.com/events',
  enableRequestBodyCompression: true,
});
```

Your proxy server must support gzip-compressed request bodies and handle the `Content-Encoding: gzip` header.

#### Browser compatibility[](#browser-compatibility "Permalink")

Request body compression requires the `CompressionStream` API, which is available in:

-   Chrome 80+
-   Edge 80+
-   Safari 16.4+
-   Firefox 113+

For browsers that don't support `CompressionStream`, the SDK automatically sends uncompressed payloads.

### Use sendBeacon[](#use-sendbeacon "Permalink")

Unlike standard network requests, `sendBeacon` sends events in the background, even if the user closes the browser or leaves the page.

## Warning

`sendBeacon` sends events in the background. As a result, events dispatched by `sendBeacon` don't return server responses. Keep the following in mind if you use `sendBeacon`:

1.  Requests are not retried, including failed requests with 4xx or 5xx responses, so events may be lost.
2.  Event order cannot be guaranteed, as `sendBeacon` may send events in parallel. This can lead to some UTM properties not being set, for example for session start events. In contrast, while using `fetch`, the SDK waits for responses before proceeding, guaranteeing event order.

#### Set the transport to use sendBeacon for all events[](#set-the-transport-to-use-sendbeacon-for-all-events "Permalink")

To send an event using `sendBeacon`, set the transport SDK option to 'beacon' in one of two ways

```ts
amplitude.init(API_KEY, 'user@amplitude.com', 
  {
    transport: TransportType.SendBeacon,
    // To make sure the event will be scheduled right away.
    flushIntervalMillis: 0,
    flushQueueSize: 1,
  }
);
```

#### Set the transport to use beacon only when exiting page[](#set-the-transport-to-use-beacon-only-when-exiting-page "Permalink")

Amplitude recommends adding your own event listener for pagehide event.

```ts
window.addEventListener('pagehide',
  () => {
    amplitude.setTransport('beacon') 
    // Sets https transport to use `sendBeacon` API
    amplitude.flush()
  },
);
```

### Content Security Policy (CSP)[](#content-security-policy-csp "Permalink")

If your web app configures the strict Content Security Policy (CSP) for security concerns, adjust the policy to whitelist the Amplitude domains:

-   When using ["Script Loader"](https://github.com/amplitude/Amplitude-TypeScript/tree/main/packages/analytics-browser#installing-via-script-loader), add `https://*.amplitude.com` to `script-src`.
-   Add `https://*.amplitude.com` to `connect-src`.

### Cookie management[](#cookie-management "Permalink")

The Browser SDK uses cookie storage to persist information that multiple subdomains of the same domain may likely want to share. This includes information like user sessions and marketing campaigns, which are stored in separate cookie entries.

#### Cookie prefix[](#cookie-prefix "Permalink")

-   **AMP**: The SDK creates user session cookies with `AMP` prefix and the first ten digits of the API key: `AMP_{first_ten_digits_API_KEY}`.
-   **AMP\_MKTG**: The SDK creates marketing campaign cookies with `AMP_MKTG` and the first ten digits of the API key: `AMP_MKTG_{first_ten_digits_API_KEY}`.
-   **AMP\_TEST**: On initialization, the SDK creates a cookie with `AMP_TEST` prefix to check whether the cookie storage is working properly. Then the SDK sets the value as the current time, retrieves the cookie by a key and checks if the retrieved value matches the original set time. You **can safely delete** the `AMP_TEST` prefix cookies if, for some reason, they're not successfully deleted.
-   **AMP\_TLDTEST**: On initialization, the SDK creates a cookie with `AMP_TLDTEST` prefix to find a subdomain that supports cookie storage. For example, when checking for cookie support on `https://analytics.amplitude.com/amplitude/home` the SDK first tries to find a subdomain that matches the root domain (`amplitude.com`) and then falls back to the full domain (`analytics.amplitude.com`). You **can safely delete** the `AMP_TLDTEST` prefix cookies if, for some reason, they're not successfully deleted.

#### Cookie domain[](#cookie-domain "Permalink")

By default, the SDK assigns these cookies to the top-level domain which supports cookie storage. Cookies can be shared on multiple subdomains which allows for a seamless user experience across all subdomains.

For example, if a user logs into the website on one subdomain (`data.amplitude.com`) where the SDK is initialized. On initialization, the SDK assigns cookies to `.amplitude.com`. If the user then navigates to another subdomain (`analytics.amplitude.com`), the login information can be seamlessly shared by shared cookies.

#### Cookie data[](#cookie-data "Permalink")

The SDK creates two types of cookies: user session cookies and marketing campaign cookies.

#### Disable cookies[](#disable-cookies "Permalink")

Opt-out of using cookies by setting `identityStorage` to `localStorage` so that the SDK will use `LocalStorage` instead. `LocalStorage` is a great alternative, but because access to `LocalStorage` is restricted by subdomain, you can't track anonymous users across subdomains of your product (for example: `www.amplitude.com` vs `analytics.amplitude.com`).

```ts
amplitude.init("api-key", null, {
  identityStorage: "localStorage",
});
```

### Offline mode[](#offline-mode "Permalink")

## Autoflush when reconnecting

Setting `config.flushIntervalMillis` to a small value like `1` may cause an `ERR_NETWORK_CHANGED` error.

Beginning with version 2.4.0, the Amplitude Browser SDK supports offline mode. The SDK checks network connectivity every time it tracks an event. If the device is connected to network, the SDK schedules a flush. If not, it saves the event to storage. The SDK also listens for changes in network connectivity and schedules a flush of all stored events when the device reconnects, based on the `config.flushIntervalMillis` setting.

To disable offline mode, add `offline: amplitude.Types.OfflineDisabled` to the `amplitude.init()` call as shown below.

```ts
amplitude.init(AMPLITUDE_API_KEY, {
  offline: amplitude.Types.OfflineDisabled
});
```

### Marketing Attribution Tracking[](#marketing-attribution-tracking "Permalink")

Amplitude tracks marketing attribution and excludes all referrers from subdomains by default. Learn more about [exclude referrers](#exclude-referrers) and [exclude internal referrers](#exclude-internal-referrers). After you enable marketing attribution tracking, Amplitude generates `identify` events to assign the campaign values as user properties in specific scenarios. Refer to the following section to learn when Amplitude tracks marketing attribution and updates user properties.

#### Tracking scenarios[](#tracking-scenarios "Permalink")

Amplitude tracks changes in marketing attribution in two scenarios: during SDK initialization and event processing.

##### Amplitude SDK initialization (Hard page refresh)[](#amplitude-sdk-initialization-hard-page-refresh "Permalink")

-   At the start of a session, the referrer isn't excluded and campaign has any change or customer first visit.
-   In the middle of the session, the referrer isn't excluded, not direct traffic, and campaign has any change.

![Diagram of whether tracking a campaign on SDK initialization](/docs/output/img/sdk/isNewCampaign.drawio.svg)

To debug, you can get the referrer by typing `document.referrer` in your Browser console and compare it with your `config.autocapture.attribution.excludeReferrers`. If `document.referrer` is empty, then it's considered as a direct traffic. You can get the session ID under `AMP_{last 10 digits of your API key}` on the "Cookies" tab of the [Amplitude Chrome extension](/docs/data/chrome-extension-debug) and get the previous campaign stored under `AMP_MKTG_{last 10 digits of your API key}`.

##### Processing the event[](#processing-the-event "Permalink")

-   At the start of a session, the referrer isn't excluded, and campaign has any change.

For more information, see the scenarios outlined below that demonstrate when Amplitude does or doesn't track marketing attribution. These examples are illustrative, not exhaustive.

Tracking occurs when either of the following applies:

Rule

Example

The current subdomain is not an excluded referrer.

The referrer does not originates from the same domain or the current subdomain is not match any referrer in `config.autocapture.attribution.excludeReferrers`.

No previous campaign.

A user's initial visit.

There is an introduction of new UTM parameter or Click ID parameter.

If any utm parameters or Click ID parameters have been dropped during a session, we will unset it.

The referrer domain changes to a new one.

Referrer domain changed from `a.test.com` to `b.test-new.com`

Amplitude doesn't track marketing attribution under any of the following conditions:

Rule

Example

The referrer originates from the same domain with default configuration.

The landing page is `a.test.com`, with the referrer set to `b.test.com`.

A specific referrer domain is explicitly excluded.

When setting `config.autocapture.attribution.excludeReferrers` = `[a.test.com]`, and the referrer domain is `a.test.com` for the current page.

The subdomain is specified or matches the regular expression in `config.autocapture.attribution.excludeReferrers`.

Configuration of excludeReferrers involves specific string arrays or a regular expression.

The user engages in direct traffic within the same session.

During a session, a user clicks on a link without any campaign attribution parameters, including the absence of UTM and click id parameters from an email.

SPA redirect without page reloading

During a session, a user clicks on a link without any campaign attribution parameters, including the absence of UTM and click id parameters from an email.

#### Rogue referral problem for SPAs[](#rogue-referral-problem-for-spas "Permalink")

SPA typically don't experience a true page load after a visitor enters the site, which means the referrer information doesn't update when clicking internal links. UTM parameters may be dropped during SPA redirects, while the referrer remains unchanged. This is a known issue in the industry. To address this problem, you can either:

-   Control the page and location parameters and / or
-   Unset the referrer after the first hit

### Remote configuration[](#remote-configuration-1 "Permalink")

Beginning with version 2.10.0, the Amplitude Browser SDK supports remote configuration.

## Default behavior changed in version 2.16.1

Starting in SDK version 2.16.1, `fetchRemoteConfig` is **enabled by default** (`true`). For versions 2.10.0 to 2.16.0, remote configuration was disabled by default and required explicit enablement.

Autocapture supports remote configuration options for tracking default events. When remote configuration is enabled, settings from Amplitude's servers merge with your local SDK configuration, with remote settings taking precedence. Find the remote configuration options in _Data > Settings > Autocapture_.

#### Enable or disable remote configuration[](#enable-or-disable-remote-configuration "Permalink")

**For SDK versions 2.16.1 and later:** Remote configuration is enabled by default. To disable it, explicitly set `fetchRemoteConfig: false`:

```ts
amplitude.init(AMPLITUDE_API_KEY, {
  fetchRemoteConfig: false  // Disable remote config
});
```

**For SDK versions 2.10.0 to 2.16.0:** Remote configuration is disabled by default. To enable it, set `fetchRemoteConfig: true`:

```ts
amplitude.init(AMPLITUDE_API_KEY, {
  fetchRemoteConfig: true  // Enable remote config (only needed for versions < 2.16.1)
});
```

## Configuration merging behavior

When you enable `fetchRemoteConfig`, the SDK merges remote configuration with local configuration at the feature level. Remote configuration can override specific autocapture features even when you set `autocapture: false` locally.

How the merging works:

-   If remote configuration specifies a value for an autocapture feature, that value takes precedence.
-   If remote configuration doesn't specify a value for a feature, the SDK uses the local configuration value.
-   Each autocapture feature such as `sessions`, `pageViews`, and `elementInteractions` merges independently.

Set baseline settings locally and adjust specific features remotely through the Amplitude UI without code changes.

In Amplitude, navigate to _Data > Settings > Autocapture_ to add or update a remote configuration.

#### Proxy remote config requests[](#proxy-remote-config-requests "Permalink")

To proxy remote configuration requests through your own server (for example, to bypass ad blockers), configure the `remoteConfig` option:

```ts
amplitude.init(AMPLITUDE_API_KEY, {
  remoteConfig: {
    serverUrl: 'https://your-proxy.example.com/config'
  }
});
```

When `remoteConfig.serverUrl` is set, the SDK sends remote configuration requests to your custom URL instead of Amplitude's endpoints. Analytics events still use `serverUrl` or the default Amplitude endpoints.

## Note

The top-level `fetchRemoteConfig` option is deprecated. Use `remoteConfig.fetchRemoteConfig` instead for new implementations.