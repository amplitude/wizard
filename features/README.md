# BDD Feature Files

Cucumber/Gherkin feature files describing the intended behavior of the
Amplitude Wizard CLI.

## Files

| File | Flow |
|---|---|
| `01-top-level-commands.feature` | login, logout, whoami, wizard entry |
| `02-wizard-flow.feature` | main wizard spine |
| `03-activation-check.feature` | returning user activation status evaluation |
| `04-susi-flow.feature` | sign up / sign in, org and project selection for new users |
| `05-data-setup-flow.feature` | data ingestion check, agent-created dashboard, Outro |
| `07-framework-detection.feature` | auto-detect, manual picker, setup questions |
| `08-outro.feature` | success, error, and cancel end states |
| `09-slash-commands.feature` | slash commands available throughout the session |
| `10-ampli-config.feature` | Ampli config detection and persistence |
| `11-slack-integration.feature` | Slack connection flow |
| `12-create-project.feature` | inline create-project flow |

## Status

BDD support is already wired into the repo via `@cucumber/cucumber` and
`pnpm test:bdd`. Some scenarios are still tagged `@todo`; others already have
step definitions under `features/step-definitions/`.

There is intentionally no `06-*.feature` file. The numbering preserves
historical ordering.

The flows in [`../docs/flows.md`](../docs/flows.md) are the source of truth these specs are derived from.
