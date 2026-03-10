# BDD Feature Files

Cucumber/Gherkin feature files describing the intended behavior of the Amplitude Wizard CLI. All scenarios are tagged `@todo` until connected to Jest step definitions.

## Files

| File | Flow |
|---|---|
| `01-top-level-commands.feature` | login, logout, whoami, wizard entry |
| `02-wizard-flow.feature` | main wizard spine |
| `03-activation-check.feature` | returning user activation status evaluation |
| `04-susi-flow.feature` | sign up / sign in, org and project selection for new users |
| `05-data-setup-flow.feature` | taxonomy, first chart, first dashboard checklist |
| `06-org-project-selection.feature` | org/project picker, create new |
| `07-framework-detection.feature` | auto-detect, manual picker, setup questions |
| `08-outro.feature` | success, error, and cancel end states |
| `09-slash-commands.feature` | slash commands available throughout the session |

## Status

All scenarios are `@todo`. To connect them to Jest, install `@cucumber/cucumber` and configure step definitions under `features/step-definitions/`.

The flows in [`../docs/flows.md`](../docs/flows.md) are the source of truth these specs are derived from.
