Amplitude offers multiple ways to install browser SDKs, each with different product support and version control options. This guide explains the three main installation methods and helps you choose the right approach for your needs.

## Tip

To skip manual setup, use the [Amplitude Setup Wizard CLI](/docs/get-started/setup-wizard-cli). It reads your codebase, proposes tracking events, and instruments the SDK automatically with your approval.

## Choose your installation method[](#choose-your-installation-method "Permalink")

Amplitude provides three main ways to install browser SDKs:

Method

Description

Version control

Best for

[Unified SDK (npm)](#unified-sdk-npm)

Single npm package with all Amplitude features

Customer-managed

Teams requiring reproducible builds and strict change management

[Unified Script (CDN)](#unified-script-cdn)

Single script tag that loads Amplitude capabilities

Amplitude-managed

Quick setup with automatic updates and sensible defaults

[GTM Template](#google-tag-manager)

Google Tag Manager template

Template version-controlled

Teams using GTM for tag management

### Product support by installation method[](#product-support-by-installation-method "Permalink")

Different installation methods support different Amplitude products:

Product

Unified Script (CDN)

Unified SDK (npm)

GTM Template

Analytics (`@amplitude/analytics-browser`)

✅ Included

✅ Included

✅ Included

Session Replay

✅ Included

✅ Included

✅ Optional (checkbox)

Guides & Surveys

⚠️ Separate script

✅ Included

✅ Optional (checkbox)

Web Experiment (`@amplitude/experiment-tag`)

✅ Included

❌ Not included

❌ Not supported

Feature Experiment (`@amplitude/experiment-js-client`)

❌ Not included

✅ Included

❌ Not supported

## Web Experiment compared with Feature Experiment

-   **Web Experiment**: Uses visual editing for no-code A/B testing on web pages. The Unified Script includes it automatically.
-   **Feature Experiment**: Uses code-based feature flags with the Experiment JavaScript SDK. The Unified npm package includes it.

## Unified SDK (npm)[](#unified-sdk-npm "Permalink")

The Unified SDK provides a single npm package (`@amplitude/unified`) giving you access to Analytics, Session Replay, Feature Experiment, and Guides & Surveys through a single API. Install it with npm or yarn, and control the version in your `package.json`.

**Key characteristics:**

-   Customer-managed package installation with full control over versions.
-   Includes Feature Experiment (code-based feature flags), not Web Experiment (visual editor).
-   Upgrade by bumping the package version in your dependency file.
-   Ideal for teams that require reproducible builds and strict change management.

## Individual product installation

If you're concerned about bundle size and only need specific products, install them individually:

-   [Analytics](/docs/sdks/analytics/browser/browser-sdk-2): For tracking user events and behavior.
-   [Experiment](/docs/sdks/experiment-sdks/experiment-javascript): For running A/B tests and feature flags.
-   [Session Replay](/docs/session-replay/session-replay-standalone-sdk): For capturing and replaying user sessions.
-   [Guides and Surveys](/docs/guides-and-surveys/sdk): For in-product messaging and surveys.

### Install the Unified SDK[](#install-the-unified-sdk "Permalink")

Install the dependency with npm or yarn.

### Initialize the Unified SDK[](#initialize-the-unified-sdk "Permalink")

The Unified SDK provides a single initialization method that initializes all Amplitude features.

```typescript
import { initAll } from '@amplitude/unified';

initAll('AMPLITUDE_API_KEY');
```

### Access SDK features[](#access-sdk-features "Permalink")

The Unified SDK provides access to all Amplitude features through a single interface:

## Feature Documentation

For detailed information about each product's features and APIs, refer to their respective documentation:

-   [Analytics Browser SDK](/docs/sdks/analytics/browser/browser-sdk-2)
-   [Experiment JavaScript SDK](/docs/sdks/experiment-sdks/experiment-javascript)
-   [Session Replay Standalone SDK](/docs/session-replay/session-replay-standalone-sdk)
-   [Guides and Surveys Web SDK](/docs/guides-and-surveys/sdk)

```typescript
import { 
  track, 
  identify, 
  experiment, 
  sessionReplay 
} from '@amplitude/unified';

// Track events
track('Button Clicked', { buttonName: 'Sign Up' });

// Identify users
identify(new Identify().set('userType', 'premium'));

// Access Experiment features
const variant = await experiment.fetch('experiment-key');

// Access Session Replay features
sessionReplay.flush();
```

### Configuration[](#configuration "Permalink")

The Unified SDK supports configuration options for all Amplitude features. You can configure each product individually while sharing some common options.

```typescript
import { initAll } from '@amplitude/unified';

initAll('AMPLITUDE_API_KEY', {
  // Shared options for all SDKs (optional)
  serverZone: 'US', // or 'EU'
  instanceName: 'my-instance',
  
  // Analytics options
  analytics: {
    // Analytics configuration options
  },
  
  // Session Replay options
  sessionReplay: {
    // Session Replay configuration options
    sampleRate: 1 // To enable session replay
  },
  
  // Experiment options
  experiment: {
    // Experiment configuration options
  },
  
  // Guides and Surveys options
  engagement: {
    // Guides and Surveys configuration options
  }
});
```

#### Shared options[](#shared-options "Permalink")

Name

Type

Default

Description

`serverZone`

`'US'` or `'EU'`

`'US'`

The server zone to use for all SDKs.

`instanceName`

`string`

`$default_instance`

A unique name for this instance of the SDK.

#### Analytics options[](#analytics-options "Permalink")

All options from `@amplitude/analytics-browser` are supported. Refer to the [Analytics Browser SDK documentation](/docs/sdks/analytics/browser/browser-sdk-2#initialize-the-sdk) for details.

#### Session Replay options[](#session-replay-options "Permalink")

The Unified Browser SDK supports all options from `@amplitude/plugin-session-replay-browser`. Refer to the [Session Replay Plugin documentation](/docs/session-replay/session-replay-plugin#configuration) for more information. Set `config.sessionReplay.sampleRate` to a non-zero value to enable Session Replay.

Sample rate controls the rate at which Amplitude captures session replays. For example, if you set `config.sessionReplay.sampleRate` to `0.5`, Session Replay captures roughly half of all sessions.

#### Experiment options[](#experiment-options "Permalink")

All options from `@amplitude/plugin-experiment-browser` are supported. Refer to the [Experiment documentation](/docs/sdks/experiment-sdks/experiment-javascript#configuration) for details.

#### Guides and Surveys options[](#guides-and-surveys-options "Permalink")

The Unified Browser SDK supports all [Guides and Surveys options](/docs/guides-and-surveys/sdk#initialize-the-sdk). The engagement plugin initializes automatically when you pass engagement options in the configuration.

## Unified script (CDN)[](#unified-script-cdn "Permalink")

The Unified Script is a single script tag that loads Amplitude browser capabilities from Amplitude's CDN. Amplitude remotely controls the versions of the underlying SDKs, offering a "single line of code" experience with sensible defaults and optional remote or manual configuration.

**Key characteristics:**

-   Amplitude manages SDK versions and can patch bugs or improve performance centrally without requiring a customer release.
-   Includes Web Experiment (visual editor) by default.
-   Session Replay and Web Experiment enable automatically with default settings.
-   Guides & Surveys requires a separate script because of size concerns.

### Install the Unified Script[](#install-the-unified-script "Permalink")

Add the following script tag to the `<head>` of your site:

```html
<script src="https://cdn.amplitude.com/script/AMPLITUDE_API_KEY.js"></script>
```

Replace `AMPLITUDE_API_KEY` with your project's API key.

### Initialize the Unified Script[](#initialize-the-unified-script "Permalink")

The Unified Script enables Session Replay and Web Experiment by default. For manual configuration:

```html
<script src="https://cdn.amplitude.com/script/AMPLITUDE_API_KEY.js"></script>
<script>
  window.amplitude.init('AMPLITUDE_API_KEY', {
    defaultTracking: true,
    autocapture: true,
    fetchRemoteConfig: true
  });
  // Enable Session Replay with custom sample rate
  window.amplitude.add(window.sessionReplay.plugin({ sampleRate: 1 }));
</script>
```

### Add Guides & Surveys to the Unified Script[](#add-guides--surveys-to-the-unified-script "Permalink")

Because of size concerns, Guides & Surveys requires a separate script. Add it after the Unified Script:

```html
<script src="https://cdn.amplitude.com/script/AMPLITUDE_API_KEY.js"></script>
<script src="https://cdn.amplitude.com/script/AMPLITUDE_API_KEY.engagement.js"></script>
<script>
  window.amplitude.add(window.engagement.plugin());
  window.amplitude.init('AMPLITUDE_API_KEY', {
    fetchRemoteConfig: true,
    autocapture: true
  });
</script>
```

Refer to the [Guides and Surveys SDK documentation](/docs/guides-and-surveys/sdk) for more configuration options.

## Google Tag Manager[](#google-tag-manager "Permalink")

The [Amplitude GTM template](/docs/data/source-catalog/google-tag-manager) directly wraps the Analytics Browser 2.0 SDK (`@amplitude/analytics-browser`). It doesn't use the Unified SDK or Unified Script.

**Key characteristics:**

-   Template version-controlled through GTM.
-   Supports Analytics, Session Replay, and Guides & Surveys.
-   Doesn't support Web Experiment or Feature Experiment.
-   Session Replay and Guides & Surveys are disabled by default and require manual checkbox selection.

### Enable Session Replay and Guides & Surveys in GTM[](#enable-session-replay-and-guides--surveys-in-gtm "Permalink")

To enable these features:

1.  Navigate to your Amplitude tag in GTM.
2.  In the tag configuration, check the **Session Replay** checkbox to enable session replays.
3.  Check the **Guides & Surveys** checkbox to enable in-product messaging.
4.  Save and publish your changes.

Refer to the [Google Tag Manager documentation](/docs/data/source-catalog/google-tag-manager) for detailed configuration options.