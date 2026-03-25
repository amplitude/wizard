# CLI Flows

## Slash commands

The CLI keeps a persistent prompt open at all times (like Claude). Slash
commands can be run at any point during the wizard to change settings or trigger
actions.

| Command      | Description                                                       |
| ------------ | ----------------------------------------------------------------- |
| `/region`    | Switch the data-center region (US or EU) — re-triggers data setup |
| `/login`     | Re-authenticate                                                   |
| `/logout`    | Clear credentials                                                 |
| `/whoami`    | Show current user, org, and project                               |
| `/overview`  | Open the project overview in the browser                          |
| `/chart`     | Set up a new chart                                                |
| `/dashboard` | Create a new dashboard                                            |
| `/taxonomy`  | Interact with the taxonomy agent                                  |
| `/slack`     | Connect your Amplitude project to Slack                           |
| `/help`      | List available slash commands                                     |

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
    CMD --> WIZARD["wizard (default)"]

    LOGIN --> LOGIN_CHECK{~/.ampli.json valid?}
    LOGIN_CHECK -->|yes| LOGIN_DONE["Display logged-in user"]
    LOGIN_CHECK -->|no| OAUTH["OAuth flow"] --> STORE["Store token"] --> LOGIN_DONE

    LOGOUT --> CLEAR["Clear ~/.ampli.json"]

    WHOAMI --> CHECK_TOKEN{Token exists?}
    CHECK_TOKEN -->|yes| SHOW_USER["Show name, email, zone"]
    CHECK_TOKEN -->|no| NOT_LOGGED_IN["Not logged in"]

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
    REGION_SELECT["RegionSelect: US or EU?<br/>(Enter = US default · skipped for returning users)"]
    REGION_SELECT --> AUTH

    subgraph AUTH ["Auth / Account Setup (AuthScreen)"]
        SUSI["See: SUSI flow<br/>(OAuth → org → workspace → API key)"]
    end

    AUTH --> DATA_SETUP["DataSetupScreen<br/>(activation check — auto-advances for now)"]
    DATA_SETUP --> DATA_CHECK{Project has data?}

    DATA_CHECK -->|no| FRAMEWORK["See: Framework Detection flow"]
    DATA_CHECK -->|yes| OPTIONS["Options: open overview / chart / dashboard / taxonomy agent / switch project"]

    OPTIONS --> MCP_SCREEN
    FRAMEWORK --> RUN

    SLASH_REGION["/region slash command"] -. available any time .-> REGION_SELECT

    subgraph AGENT_RUN ["Agent Run (RunScreen)"]
        RUN["RunScreen"] --> AGENT["Claude agent runs"]
        AGENT --> SDK_INSTALL["1. Install SDK + add initialization code"]
        SDK_INSTALL --> PLAN_TOOL["2. confirm_event_plan tool<br/>(present plan to user via ConsoleView overlay)"]
        PLAN_TOOL --> PLAN_LOOP{User decision?}
        PLAN_LOOP -->|feedback| PLAN_REVISE["Agent revises plan"] --> PLAN_TOOL
        PLAN_LOOP -->|approve| INSTRUMENT["3. Instrument events with track() calls"]
        PLAN_LOOP -->|skip| OUTCOME
        INSTRUMENT --> FEATURES{Features discovered?}
        FEATURES -->|Stripe| STRIPE_TIP["Show Stripe tip"] --> OUTCOME
        FEATURES -->|LLM| LLM_TIP["Show LLM tip"] --> OUTCOME
        FEATURES -->|none| OUTCOME
        AGENT --> OUTCOME{Outcome?}
        OUTCOME -->|success| POST["Upload env vars to hosting"]
        OUTCOME -->|error| ERR["Set error state"]
    end

    POST --> MCP_SCREEN["McpScreen<br/>(install MCP server — skipped on error)"]
    ERR --> OUTRO["See: Outro flow"]
    MCP_SCREEN --> SLACK_SCREEN["SlackScreen<br/>(connect Slack — skipped on error)"]
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

```mermaid
---
title: Data Setup flow
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

```mermaid
---
title: Framework Detection flow
---
flowchart TD
    DETECT{Auto-detect framework?}
    DETECT -->|success| RESULT["Show detection result"]
    DETECT -->|failed| GENERIC["Auto-select Generic integration"] --> RESULT
    DETECT -->|--menu flag| PICKER["Framework picker menu"] --> RESULT
    RESULT --> CONFIRM{User confirms?}
    CONFIRM -->|cancel| EXIT["Exit"]
    CONFIRM -->|continue| SETUP_Q{Unresolved setup questions?}
    SETUP_Q -->|no| RUN["→ Agent Run"]
    SETUP_Q -->|yes| SETUP["SetupScreen"]
    SETUP --> ANSWER{Answer auto-detectable?}
    ANSWER -->|yes| RUN
    ANSWER -->|no| PICKER_Q["PickerMenu for question"] --> RUN
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
