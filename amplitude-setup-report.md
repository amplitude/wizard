<wizard-report>
# Amplitude post-wizard report

The wizard has completed a deep integration of your project. The Amplitude Wizard CLI already had a custom analytics implementation in `src/utils/analytics.ts` that directly calls the Amplitude HTTP API v2 using `AMPLITUDE_API_KEY` and `AMPLITUDE_SERVER_URL` environment variables. Six new wizard-specific analytics events were added to cover previously untracked user interactions across the TUI flow.

| Event Name | Description | File |
|---|---|---|
| `wizard: intro cancelled` | User selected 'Cancel' on the IntroScreen instead of continuing with setup | `src/ui/tui/screens/IntroScreen.tsx` |
| `wizard: framework manually selected` | User manually changed the auto-detected framework using the framework picker | `src/ui/tui/screens/IntroScreen.tsx` |
| `wizard: activation level determined` | The activation check resolved with a specific level (none, partial, or full) and its source | `src/ui/tui/screens/DataSetupScreen.tsx` |
| `wizard: setup question answered` | User answered a framework setup disambiguation question | `src/ui/tui/screens/SetupScreen.tsx` |
| `wizard: agent completed` | The agent run finished successfully, before the outro screen is shown | `src/lib/agent-runner.ts` |
| `wizard: outro action taken` | User selected an action on the OutroScreen (view report, open dashboard, or exit) | `src/ui/tui/screens/OutroScreen.tsx` |

## Environment variables

The following environment variables were updated in `.env`:
- `AMPLITUDE_API_KEY` — Amplitude project API key
- `AMPLITUDE_SERVER_URL` — Amplitude ingestion endpoint (`https://api2.amplitude.com`)

## Existing instrumentation

The project already tracked: `wizard: auth complete`, `wizard: setup confirmed`, `wizard: agent started`, `wizard: agent api error`, `wizard: feature enabled`, `wizard: mcp complete`, `wizard: slack complete`, `wizard: session ended`, and all screen transitions (`wizard: screen <name>`).

## Next steps

Use Amplitude's event explorer to verify events are flowing in as users run the wizard. The new events fill in funnel gaps — you can now build a complete funnel from wizard start → auth → activation check → agent run → outro action.

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-javascript_web/`. You can use this context for further agent development when using Claude Code.

</wizard-report>
