Get from zero to insights in minutes with three easy ways to get Amplitude up and running.

## Pick the best path for you[](#pick-the-best-path-for-you "Permalink")

Three ways to get started. Click one to jump to the full setup guide.

[

Setup wizard CLI

~15 min Recommended

**Best for**

Developers or anyone comfortable in a terminal

**What you get**

-   Full SDK
-   MCP integration
-   Slack/Teams integration
-   And more

See setup guide ↓



](#setup-wizard-cli)[

AI prompt

~5 min

**Best for**

Non-developers with codebase access

**What you get**

-   Full SDK

See setup guide ↓



](#ai-prompt)[

Browser snippet

~2 min

**Best for**

Anyone, web only

**What you get**

-   Script tag

See setup guide ↓



](#browser-snippet)

Amplitude offers three quickstart installation paths:

1.  Setup wizard CLI: Takes about 15 minutes. Best for developers or anyone comfortable in a terminal. This is the recommended option. You get full SDK setup, MCP integration, Slack/Teams integration, and more. Run npx @amplitude/wizard in your terminal.
    
2.  AI prompt: Takes about 5 minutes. Best for non-developers with codebase access. You get full SDK setup. Copy a pre-built prompt into an AI coding tool like Cursor, Claude Code, or Lovable to install the Amplitude Unified Browser SDK.
    
3.  Browser snippet: Takes about 2 minutes. Best for anyone, web only. You get a script tag. Paste a snippet into your site's head tag. No build step, dependencies, or codebase access required.
    

## Setup wizard CLI[](#setup-wizard-cli "Permalink")

One command takes you from zero to fully instrumented in minutes. The wizard authenticates you with Amplitude through OAuth, auto-detects your framework (18+ supported, including Next.js, React Router, Vue, Django, Flask, React Native, Swift, Android, and Flutter), analyzes your codebase to propose custom tracking events, instruments everything, and verifies your data arrives in Amplitude before it completes.

```bash
npx @amplitude/wizard
```

**Where to run it:** In your terminal or in Claude Code within your terminal.

**Time:** ~15 min.

**What you get:**

-   Full SDK setup.
-   [Autocapture.](/docs/data/autocapture)
-   [Session Replay.](/docs/session-replay)
-   [Feature Experiment.](/docs/feature-experiment/workflow/feature-flag-rollouts)
-   [Guides & Surveys.](/docs/guides-and-surveys)
-   AI-generated custom events.
-   [MCP integration.](/docs/amplitude-ai/amplitude-mcp)
-   [Slack](/docs/analytics/integrate-slack) and [Teams](/docs/analytics/integrate-microsoft-teams) integration.

**Tips:**

-   Use `--menu` to manually select your framework instead of relying on auto-detection.
-   Requires Node.js 20.
-   Need an API key? Create a [free Amplitude account](https://app.amplitude.com/signup) to get started.
-   Press `tab` and chat with the wizard to ask questions and give feedback at any time.

* * *

## AI prompt[](#ai-prompt "Permalink")

Copy this prompt into an AI coding tool to set up the Amplitude Unified Browser SDK. The prompt instructs your AI tool to install the SDK, configure it for your project, and enable the features you select.

## Set up with an AI prompt

Customize your installation by selecting the features and data region for your project.

 Autocapture Session Replay

Data region

US EU

Click the Key icon to insert your Amplitude API key.

```plaintext
__AI_PROMPT_PLACEHOLDER__
```

**Where to run it:** AI coding tools like Cursor, Claude Code, or managed workspaces like Lovable and Bolt.

**Time:** ~5 min.

**What you get:**

-   Full SDK setup.
-   [Autocapture.](/docs/data/autocapture)
-   [Session Replay.](/docs/session-replay)
-   [Feature Experiment.](/docs/feature-experiment/workflow/feature-flag-rollouts)
-   [Guides & Surveys.](/docs/guides-and-surveys)

**Tips:**

-   Click the **Key** icon in the code block to insert your Amplitude API key.
-   Need an API key? Create a [free Amplitude account](https://app.amplitude.com/signup) to get started. When you create your account, Amplitude generates a ready-to-use prompt with your API key.

* * *

## Browser snippet[](#browser-snippet "Permalink")

Paste this script tag inside the `<head>` of your site. You don't need a build step, dependencies, or codebase access.

## Set up with a browser snippet

Customize your installation by selecting the features and data region for your project.

 Autocapture Session Replay

Data region

US EU

Click the Key icon to insert your Amplitude API key.

```html
<script src="https://cdn.amplitude.com/script/AMPLITUDE_API_KEY.js"></script><script>window.amplitude.add(window.sessionReplay.plugin({sampleRate: 1}));window.amplitude.init('AMPLITUDE_API_KEY', {"fetchRemoteConfig":true,"autocapture":{"attribution":true,"fileDownloads":true,"formInteractions":true,"pageViews":true,"sessions":true,"elementInteractions":true,"networkTracking":true,"webVitals":true,"frustrationInteractions":true}});</script>
```

**Where to run it:** Paste into your site's `<head>` tag.

**Time:** ~2 min.

**What you get:**

-   Script tag.
-   [Autocapture.](/docs/data/autocapture)
-   [Session Replay.](/docs/session-replay)
-   [Feature Experiment.](/docs/feature-experiment/workflow/feature-flag-rollouts)

**Tips:**

-   Click the **Key** icon in the code block to insert your Amplitude API key.
-   Need an API key? Create a [free Amplitude account](https://app.amplitude.com/signup) to get started.

* * *

## Take the next step[](#take-the-next-step "Permalink")

Once data flows into Amplitude, expand your setup:

-   **Amplitude MCP server.** Query your analytics data from Claude, Cursor, or any MCP-compatible AI tool. [Learn about the Amplitude MCP server](/docs/amplitude-ai/amplitude-mcp).
    
-   **Claude Code plugin.** Install Amplitude as a [Claude Code plugin](https://github.com/amplitude/mcp-marketplace/tree/main/plugins/amplitude) for built-in slash commands.
    
    Inside a Claude Code session:
    
    ```bash
    /plugin install amplitude
    ```
    
    Or from your terminal:
    
    ```bash
    claude plugin install amplitude
    ```
    
    The plugin includes slash commands like `/amplitude:create-chart`, `/amplitude:create-dashboard`, `/amplitude:instrument-events`, `/amplitude:replay-ux-audit`, and `/amplitude:weekly-brief`.
    
-   **Custom events.** Go beyond Autocapture and track events specific to your product. [Learn about tracking events](/docs/sdks/analytics/browser/browser-sdk-2#track-an-event).
    
-   **User identification.** Connect anonymous activity to known users. [Learn about identifying users](/docs/sdks/analytics/browser/browser-sdk-2#set-a-user-id).
    
-   **Group analytics.** Analyze behavior at the account or team level. [Learn about user groups](/docs/sdks/analytics/browser/browser-sdk-2#user-groups).