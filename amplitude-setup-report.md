# Amplitude post-wizard report

The wizard has completed a deep integration of the Amplitude Wizard CLI project. Eight new analytics events were instrumented across four source files, filling gaps in the existing `analytics.wizardCapture()` tracking system. The new events cover the complete user journey: intro screen decisions, framework selection, session credential updates (with user identification), data ingestion confirmation, post-setup checklist completion, outro screen interactions, console command/message inputs, and all prompt responses (confirm, choice, and event-plan). User identity is now established via `analytics.setDistinctId()` at authentication time.

| Event name | Description | File |
|---|---|---|
| `wizard: intro action` | User selects continue, change framework, or cancel on the IntroScreen. Properties: `action`, `integration`, `detected_framework`. | `src/ui/tui/screens/IntroScreen.tsx` |
| `wizard: framework manually selected` | User manually picks a framework from the picker. Properties: `integration`. | `src/ui/tui/screens/IntroScreen.tsx` |
| `wizard: credentials updated` | Fired after authentication completes and a session is established. Properties: `project_id`, `region`. Also sets `distinctId`. | `src/ui/tui/store.ts` |
| `wizard: data ingestion confirmed` | Polling detects events flowing into Amplitude after SDK install. Properties: session properties (integration, region, etc.). | `src/ui/tui/store.ts` |
| `wizard: checklist completed` | User finishes or skips the post-setup checklist. Properties: `chart_complete`, `dashboard_complete`, plus session properties. | `src/ui/tui/store.ts` |
| `wizard: outro action` | User selects view report, open dashboard, or exit on the OutroScreen. Properties: `action`, `outro_kind`. | `src/ui/tui/screens/OutroScreen.tsx` |
| `wizard: agent message sent` | User submits input in the console (slash command or free-text query). Properties: `message_length`, `is_slash_command`. | `src/ui/tui/components/ConsoleView.tsx` |
| `wizard: prompt response` | User responds to a confirm, choice, or event-plan prompt. Properties: `prompt_kind`, `response`. | `src/ui/tui/store.ts` |

## Next steps

We've built a dashboard and charts to track user behavior across the wizard setup flow:

- **Dashboard — Analytics basics:** https://app.amplitude.com/analytics/amplitude/dashboard/phxms0xp
- **Wizard Setup Funnel:** https://app.amplitude.com/analytics/amplitude/chart/sa9mnpou
- **Wizard Weekly Active Users:** https://app.amplitude.com/analytics/amplitude/chart/xdb0shoj
- **Wizard Event Volume Breakdown:** https://app.amplitude.com/analytics/amplitude/chart/cif28vh2

Once the updated wizard code ships and users run it, the new events will populate in Amplitude. Update the funnel chart to use `wizard: intro action → wizard: agent started → wizard: agent completed` and add the additional charts noted in the dashboard.

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating Amplitude.
