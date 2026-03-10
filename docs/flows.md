# CLI Flows

## Slash commands

The CLI keeps a persistent prompt open at all times (like Claude). Slash commands can be run at any point during the wizard to change settings or trigger actions.

| Command | Description |
|---|---|
| `/org` | Switch the active org |
| `/project` | Switch the active project |
| `/login` | Re-authenticate |
| `/logout` | Clear credentials |
| `/whoami` | Show current user, org, and project |
| `/overview` | Open the project overview in the browser |
| `/chart` | Set up a new chart |
| `/dashboard` | Create a new dashboard |
| `/taxonomy` | Interact with the taxonomy agent |
| `/help` | List available slash commands |

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
    START["IntroScreen"] --> AUTH_CHECK

    subgraph AUTH ["Auth / Account Setup"]
        AUTH_CHECK{~/.ampli.json present?}
        AUTH_CHECK -->|yes| ACTIVATION["See: Activation Check flow"]
        AUTH_CHECK -->|no| SUSI["See: SUSI flow"]
        SUSI --> DATA_SETUP["See: Data Setup flow"]
        DATA_SETUP --> DATA_CHECK
        ACTIVATION --> DATA_CHECK
        DATA_CHECK{Project has data?}
    end

    DATA_CHECK -->|no| FRAMEWORK["See: Framework Detection flow"]
    DATA_CHECK -->|yes| NEW_PROJECT{Setting up<br/>a new project?}
    NEW_PROJECT -->|yes| ORG_PROJECT["See: Org / Project Selection flow"]
    NEW_PROJECT -->|no| OPTIONS["Options: open overview / chart / dashboard / taxonomy agent / switch org or project"]
    ORG_PROJECT --> DATA_CHECK

    OPTIONS -->|switch org or project| ORG_PROJECT
    OPTIONS -->|other option| RUN
    FRAMEWORK --> RUN

    SLASH_CMD["/org · /project slash commands"] -. available any time .-> ORG_PROJECT

    subgraph AGENT_RUN ["Agent Run"]
        RUN["RunScreen"] --> AGENT["Claude agent runs"]
        AGENT --> FEATURES{Features discovered?}
        FEATURES -->|Stripe| STRIPE_TIP["Show Stripe tip"] --> OUTCOME
        FEATURES -->|LLM| LLM_TIP["Show LLM tip"] --> OUTCOME
        FEATURES -->|none| OUTCOME
        AGENT --> OUTCOME{Outcome?}
        OUTCOME -->|success| POST["Upload env vars to hosting"]
        OUTCOME -->|error| ERR["Set error state"]
    end

    POST --> OUTRO["See: Outro flow"]
    ERR --> OUTRO

    START -. overlay .-> OUTAGE["OutageScreen"]
    START -. overlay .-> SETTINGS_OVR["SettingsOverrideScreen"]
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

```mermaid
---
title: SUSI flow
---
flowchart TD
    EMAIL["Enter email"] --> USER_TYPE{Existing user?}
    USER_TYPE -->|existing| ORG_PICKER["Picker: existing orgs + 'Create new'"]
    USER_TYPE -->|new| SIGNUP["Sign up"] --> ORG_NAME["Text input: name your org"]

    ORG_PICKER -->|existing org selected| PROJ_PICKER
    ORG_PICKER -->|create new| ORG_NAME --> PROJ_PICKER

    PROJ_PICKER["Picker: existing projects + 'Create new'"]
    PROJ_PICKER -->|existing project selected| DONE["→ Data Setup flow"]
    PROJ_PICKER -->|create new| PROJ_NAME["Text input: name your project"] --> DONE
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

## Org / Project Selection flow

> Available as `--org` and `--project` CLI args in CI mode. In the wizard, `/org` and `/project` slash commands can invoke this at any time.

```mermaid
---
title: Org / Project Selection flow
---
flowchart TD
    ORG_PICKER["Picker: existing orgs + 'Create new'"]
    ORG_PICKER -->|existing org selected| PROJ_PICKER
    ORG_PICKER -->|create new| ORG_NAME["Text input: name your org"] --> PROJ_PICKER

    PROJ_PICKER["Picker: existing projects + 'Create new'"]
    PROJ_PICKER -->|existing project selected| DONE
    PROJ_PICKER -->|create new| PROJ_NAME["Text input: name your project"] --> DONE
    DONE["→ continue"]
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
    DETECT -->|failed or --menu| PICKER["Framework picker menu"] --> RESULT
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
