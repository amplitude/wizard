# CLI Flows

## Slash commands

The CLI keeps a persistent prompt open at all times (like Claude). Slash
commands can be run at any point during the wizard to change settings or trigger
actions.

| Command      | Description                                                       |
| ------------ | ----------------------------------------------------------------- |
| `/region`    | Switch the data-center region (US or EU) — re-triggers data setup |
| `/org`       | Switch the active org                                             |
| `/project`   | Switch the active project                                         |
| `/login`     | Re-authenticate                                                   |
| `/logout`    | Clear stored credentials                                          |
| `/whoami`    | Show current user, org, and project                               |
| `/mcp`       | Install or remove the Amplitude MCP server                        |
| `/slack`     | Set up Amplitude Slack integration                                |
| `/feedback`  | Send product feedback (event `wizard: feedback submitted`)        |
| `/test`      | Run a prompt-skill demo (confirm + choose)                        |
| `/snake`     | Play Snake                                                        |
| `/exit`      | Exit the wizard                                                   |

---

## Top-level commands

```mermaid
---
title: Top-level commands
---
flowchart TD
    CLI["amplitude-wizard CLI"] --> CMD{Command?}

    CMD --> LOGIN["login"]
    CMD --> LOGOUT["logout"]
    CMD --> WHOAMI["whoami"]
    CMD --> FEEDBACK["feedback"]
    CMD --> SLACK_CMD["slack"]
    CMD --> REGION_CMD["region"]
    CMD --> MCP_CMD["mcp add / mcp remove"]
    CMD --> COMPLETION["completion"]
    CMD --> WIZARD["wizard (default)"]
    CMD --> AGENT["wizard --agent<br/>(structured JSON output for automation)"]

    FEEDBACK --> FEEDBACK_SEND["Track wizard: feedback submitted via Node SDK"]

    AGENT --> AGENT_UI["AgentUI — non-interactive, JSON-line output<br/>structured exit codes (0/1/2/3/4/10/130)"]

    LOGIN --> LOGIN_CHECK{~/.ampli.json valid?}
    LOGIN_CHECK -->|yes| LOGIN_DONE["Display logged-in user"]
    LOGIN_CHECK -->|no| OAUTH["OAuth flow"] --> STORE["Store token"] --> LOGIN_DONE

    LOGOUT --> CLEAR["Clear ~/.ampli.json"]

    WHOAMI --> CHECK_TOKEN{Token exists?}
    CHECK_TOKEN -->|yes| SHOW_USER["Show name, email, zone"]
    CHECK_TOKEN -->|no| NOT_LOGGED_IN["Not logged in"]

    SLACK_CMD --> SLACK_TUI["Launch TUI SlackSetup flow"]
    REGION_CMD --> REGION_TUI["Launch TUI RegionSelect flow"]
    MCP_CMD --> MCP_INSTALL["Install/remove MCP server in editors"]
    COMPLETION --> SHELL_COMP["Generate zsh/bash completions"]

    WIZARD --> MODE{Mode?}
    MODE -->|--ci| CI["CI mode (--org, --project, --api-key, --install-dir)"]
    MODE -->|default| W["See: Wizard flow"]
```

---

## Wizard flow

```mermaid
---
title: Wizard flow
---
flowchart TD
    INTRO["IntroScreen<br/>(shows detected framework — detection runs before TUI starts;<br/>falls back to generic if undetected · user confirms or exits)<br/>If a crash-recovery checkpoint exists for this project,<br/>the user is prompted to resume or start fresh"]
    INTRO --> REGION_SELECT

    REGION_SELECT["RegionSelect: US or EU?<br/>(Enter = US default · skipped for returning users)"]
    REGION_SELECT --> AUTH

    subgraph AUTH ["Auth / Account Setup (AuthScreen)"]
        SUSI["See: SUSI flow<br/>(OAuth → org → workspace → API key)"]
    end

    AUTH --> DATA_SETUP["DataSetupScreen<br/>(activation check — sets activationLevel: none / partial / full)"]
    DATA_SETUP --> DATA_CHECK{activationLevel?}

    DATA_CHECK -->|partial — SDK installed, few events| ACTIVATION_OPTIONS["ActivationOptionsScreen<br/>(help me test / I'm blocked / exit)"]
    DATA_CHECK -->|full — 50+ events| MCP_SCREEN
    DATA_CHECK -->|none — no SDK, no events| SETUP_Q

    ACTIVATION_OPTIONS -->|test locally or blocked| SETUP_Q
    ACTIVATION_OPTIONS -->|exit| OUTRO

    SETUP_Q{Unresolved setup questions?}
    SETUP_Q -->|no| RUN
    SETUP_Q -->|yes| SETUP["SetupScreen<br/>(per-framework questions)"]
    SETUP --> RUN

    SLASH_REGION["/region slash command"] -. available any time .-> REGION_SELECT

    subgraph AGENT_RUN ["Agent Run (RunScreen)"]
        RUN["RunScreen"] --> AGENT["Claude agent runs"]
        AGENT --> SDK_INSTALL["1. Install SDK + add initialization code"]
        SDK_INSTALL --> INSTRUMENT["2. Instrument events from approved plan"]
        INSTRUMENT --> IDENTIFY["3. User identification<br/>(scan for auth patterns · confirm_identify_plan · setUserId/identify/reset)"]
        IDENTIFY --> FEATURES{Features discovered?}
        FEATURES -->|Stripe| STRIPE_TIP["Show Stripe tip"] --> OUTCOME
        FEATURES -->|LLM| LLM_TIP["Show LLM tip"] --> OUTCOME
        FEATURES -->|none| OUTCOME
        AGENT --> OUTCOME{Outcome?}
        OUTCOME -->|success| POST["Upload env vars to hosting"]
        OUTCOME -->|error| ERR["Set error state"]
    end

    POST --> MCP_SCREEN["McpScreen<br/>(install MCP server · skipped on error)"]
    ERR --> OUTRO["See: Outro flow"]
    MCP_SCREEN --> DATA_INGESTION["DataIngestionCheckScreen<br/>(polls activation API every 30s · skipped on error)<br/>full users pass immediately · user can exit and resume later<br/>Shows rotating coaching tips while waiting<br/>On success: celebration animation with explicit 'continue' prompt"]
    DATA_INGESTION --> CHECKLIST["ChecklistScreen<br/>(first chart · first dashboard · taxonomy @todo)<br/>dashboard unlocks after chart · user can skip any item"]
    CHECKLIST --> SLACK_SCREEN["SlackScreen<br/>(connect Slack — skipped on error)"]
    SLACK_SCREEN --> OUTRO

    SUSI -. overlay .-> OUTAGE["OutageScreen"]
    RUN -. overlay, before agent starts .-> SETTINGS_OVR["SettingsOverrideScreen"]
```

---

## Activation Check flow

```mermaid
---
title: Activation Check flow
---
flowchart TD
    EVENTS{Events ingested?}
    EVENTS -->|50+| ACTIVATED["Activated → proceed to data check"]
    EVENTS -->|1–49| ONBOARDED["Onboarded, not yet activated"]
    EVENTS -->|0| SNIPPET

    ONBOARDED --> SNIPPET{Snippet configured?}
    SNIPPET -->|no| SETUP_SNIPPET["See: Framework Detection flow<br/>(set up snippet)"] --> UNBLOCKED
    SNIPPET -->|yes| DEPLOYED{App deployed?}
    DEPLOYED -->|yes| UNBLOCKED
    DEPLOYED -->|no| UNBLOCKED

    UNBLOCKED{"What would you like to do?"}
    UNBLOCKED -->|help me test locally| FRAMEWORK["See: Framework Detection flow"]
    UNBLOCKED -->|I'm done for now| EXIT["Exit — resume when data arrives"]
    UNBLOCKED -->|I'm blocked| AGENT["See: Agent Run<br/>(debug mode)"]
    UNBLOCKED -->|take me to the docs| DOCS["Open docs in browser"] --> UNBLOCKED
```

---

## SUSI flow

The SUSI flow runs inside `AuthScreen`. Authentication happens via Amplitude
OAuth (browser redirect). No email is entered in the wizard itself.

```mermaid
---
title: SUSI flow
---
flowchart TD
    OAUTH_WAIT["Show OAuth spinner + login URL<br/>(bin.ts opens browser, AuthScreen waits)"]
    OAUTH_WAIT --> OAUTH_DONE["OAuth completes — region auto-detected from token"]

    OAUTH_DONE --> ORG_COUNT{How many orgs?}
    ORG_COUNT -->|1| WORKSPACE_COUNT
    ORG_COUNT -->|many| ORG_PICKER["Picker: select org"] --> WORKSPACE_COUNT

    WORKSPACE_COUNT{How many workspaces?}
    WORKSPACE_COUNT -->|1| WRITE_AMPLI
    WORKSPACE_COUNT -->|many| WS_PICKER["Picker: select workspace"] --> WRITE_AMPLI

    WRITE_AMPLI["Write ~/.ampli.json<br/>(OrgId, WorkspaceId, Zone)"]

    WRITE_AMPLI --> KEY_CHECK{Saved API key?<br/>keychain or .env.local}
    KEY_CHECK -->|yes| AUTO_KEY["Auto-advance — no prompt"]
    KEY_CHECK -->|no| KEY_INPUT["Text input: paste Amplitude API key"]
    KEY_INPUT --> PERSIST["Persist key to system keychain<br/>or .env.local (gitignored)"]

    AUTO_KEY --> DONE["Credentials set → DataSetup"]
    PERSIST --> DONE
```

---

## Data Setup flow

> **Partially implemented.** `DataSetupScreen` sets `activationLevel` (none /
> partial / full). `DataIngestionCheckScreen` polls until events arrive.
> `ChecklistScreen` offers first chart and first dashboard via browser
> deep-links. Taxonomy agent and direct GraphQL chart/dashboard creation are
> planned. See `features/05-data-setup-flow.feature` for the full target
> behaviour.

```mermaid
---
title: Data Setup flow (planned)
---
flowchart TD
    START["Project created"] --> CHOICE{How do you want<br/>to get started?}
    CHOICE -->|data onboarding wizard| CONFIGURE["Data Setup (configure)"]
    CHOICE -->|taxonomy agent| TAXONOMY["Taxonomy Agent"]

    CONFIGURE --> INGESTED{Events successfully<br/>ingested?}
    INGESTED -->|no| DONE["→ Wizard flow: data check"]
    INGESTED -->|yes| CHECKLIST

    TAXONOMY --> CHECKLIST

    CHECKLIST["Checklist: taxonomy / first chart / first dash<br/>(show completed items, offer remaining)"]
    CHECKLIST -->|run taxonomy agent| TAXONOMY_RUN["Taxonomy Agent"] --> CHECKLIST
    CHECKLIST -->|create first chart| CHART_RUN["First Chart"] --> CHECKLIST
    CHECKLIST -->|create first dash — unlocked after chart| DASH_RUN["First Dash"] --> CHECKLIST
    CHECKLIST -->|all three complete| OPEN_SITE["Open dashboard in browser"]
    OPEN_SITE --> DONE
```

---

## Framework Detection flow

> **Implementation note:** Detection runs eagerly in `run.ts` before the TUI
> starts. The result (or generic fallback) is stored in `session.integration`
> and displayed in `IntroScreen`, where the user confirms or exits. `--menu`
> skips auto-detection and shows a picker inside IntroScreen instead.

```mermaid
---
title: Framework Detection flow
---
flowchart TD
    PRE["run.ts — before TUI starts"]
    PRE --> DETECT{Auto-detect framework?}
    DETECT -->|success| STORE["Store integration in session"]
    DETECT -->|failed| GENERIC["Store Generic integration in session"] --> STORE
    DETECT -->|--menu flag| PICKER["Framework picker menu in IntroScreen"] --> STORE

    STORE --> INTRO["IntroScreen shows result"]
    INTRO --> CONFIRM{User confirms?}
    CONFIRM -->|cancel| EXIT["Exit"]
    CONFIRM -->|continue| SETUP_Q{Unresolved setup questions?}
    SETUP_Q -->|no| PLAN["→ PlanScreen"]
    SETUP_Q -->|yes| SETUP["SetupScreen"]
    SETUP --> ANSWER{Answer auto-detectable?}
    ANSWER -->|yes| PLAN
    ANSWER -->|no| PICKER_Q["PickerMenu for question"] --> PLAN
```

---

## Outro flow

```mermaid
---
title: Outro flow
---
flowchart TD
    OUTRO["OutroScreen"] --> OUTCOME{Outcome?}
    OUTCOME -->|success| SUCCESS["Show changes, events, docs/continue URLs"]
    OUTCOME -->|error| ERR["Show error message"]
    OUTCOME -->|cancel| CANCEL["Show cancel message"]
    SUCCESS --> EXIT["Press key to exit"]
    ERR --> EXIT
    CANCEL --> EXIT
```
