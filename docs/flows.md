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
| `/mcp` | Manage MCP server installation |
| `/help` | List available slash commands |

---

## Top-level commands

```mermaid
flowchart TD
    CLI["amplitude-wizard CLI"] --> CMD{Command?}

    CMD --> LOGIN["login"]
    CMD --> LOGOUT["logout"]
    CMD --> WHOAMI["whoami"]
    CMD --> MCP_CMD["mcp add / mcp remove"]
    CMD --> WIZARD["wizard (default)"]

    LOGIN --> LOGIN_CHECK{~/.ampli.json\nvalid?}
    LOGIN_CHECK -->|yes| LOGIN_DONE["Display logged-in user"]
    LOGIN_CHECK -->|no| OAUTH["OAuth flow"] --> STORE["Store token"] --> LOGIN_DONE

    LOGOUT --> CLEAR["Clear ~/.ampli.json"]

    WHOAMI --> CHECK_TOKEN{Token exists?}
    CHECK_TOKEN -->|yes| SHOW_USER["Show name, email, zone"]
    CHECK_TOKEN -->|no| NOT_LOGGED_IN["Not logged in"]

    MCP_CMD --> MCP_FLOW["See: MCP flow"]

    WIZARD --> MODE{Mode?}
    MODE -->|--playground| PLAYGROUND["Playground TUI"]
    MODE -->|--ci| CI["CI mode (--org, --project, --api-key, --install-dir)"]
    MODE -->|default| W["See: Wizard flow"]
```

---

## Wizard flow

```mermaid
flowchart TD
    START["IntroScreen"] --> AUTH_CHECK

    subgraph AUTH ["Auth / Account Setup"]
        AUTH_CHECK{~/.ampli.json present?}
        AUTH_CHECK -->|yes| ACTIVATION["Evaluate activation status for project"]
        AUTH_CHECK -->|no| SUSI["See: SUSI flow"]
        SUSI --> DATA_SETUP["See: Data Setup flow"]
        DATA_SETUP --> DATA_CHECK
        ACTIVATION --> DATA_CHECK
    end

    DATA_CHECK{Project has data?}
    DATA_CHECK -->|no| FRAMEWORK["See: Framework Detection flow"]
    DATA_CHECK -->|yes| NEW_PROJECT{Setting up\na new project?}
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
        FEATURES -->|Stripe| STRIPE_TIP["Show Stripe tip"]
        FEATURES -->|LLM| LLM_TIP["Show LLM tip"]
        AGENT --> OUTCOME{Outcome?}
        OUTCOME -->|success| POST["Upload env vars to hosting"]
        OUTCOME -->|error| ERR["Set error state"]
    end

    POST --> MCP["See: MCP flow"]
    ERR --> MCP

    MCP --> OUTRO["See: Outro flow"]

    TUI -. overlay .-> OUTAGE["OutageScreen"]
    TUI -. overlay .-> SETTINGS_OVR["SettingsOverrideScreen"]
```

---

## SUSI flow

```mermaid
flowchart TD
    EMAIL["Enter email"] --> USER_TYPE{Existing user?}
    USER_TYPE -->|existing| ORG{Org?}
    USER_TYPE -->|new| SIGNUP["Sign up"] --> ORG
    ORG -->|new org| PROJECT{Project?}
    ORG -->|existing org| PROJECT
    PROJECT -->|new project| DONE["→ Data Setup flow"]
    PROJECT -->|existing project| DONE
```

---

## Data Setup flow

```mermaid
flowchart TD
    ORG_EXISTS["Org exists"] --> PROJ_EXISTS["Project exists"]
    PROJ_EXISTS --> CONFIGURE["Data Setup (configure)"]
    CONFIGURE --> TAXONOMY["Taxonomy Agent"]
    TAXONOMY --> FIRST_CHART["First Chart"]
    TAXONOMY --> FIRST_DASH["First Dash"]
    FIRST_CHART --> DONE["→ Wizard flow: data check"]
    FIRST_DASH --> DONE
```

---

## Org / Project Selection flow

> Available as `--org` and `--project` CLI args in CI mode. In the wizard, `/org` and `/project` slash commands can invoke this at any time.

```mermaid
flowchart TD
    ORG{Org?}
    ORG -->|one org| AUTO_ORG["Auto-select org"]
    ORG -->|multiple orgs| ORG_PICKER["Org picker menu"]
    AUTO_ORG --> PROJECT
    ORG_PICKER --> PROJECT

    PROJECT{Project?}
    PROJECT -->|new project| NEW_PROJ["Create new project"] --> DONE
    PROJECT -->|existing project| PROJ_PICKER["Project picker menu"] --> DONE
    DONE["→ continue"]
```

---

## Framework Detection flow

```mermaid
flowchart TD
    DETECT{Auto-detect framework?}
    DETECT -->|success| RESULT["Show detection result"]
    DETECT -->|failed or --menu| PICKER["Framework picker menu"] --> RESULT
    RESULT --> CONFIRM{User confirms?}
    CONFIRM -->|cancel| EXIT["Exit"]
    CONFIRM -->|continue| SETUP_Q{Unresolved setup questions?}
    SETUP_Q -->|no| RUN["→ Agent Run"]
    SETUP_Q -->|yes| SETUP["SetupScreen"]
    SETUP --> AUTO{Auto-detect answers?}
    AUTO -->|detected| RUN
    AUTO -->|undetected| PICKER_Q["PickerMenu for question"] --> RUN
```

---

## MCP flow

```mermaid
flowchart TD
    DETECT{MCP clients detected?}
    DETECT -->|none| SKIP["Skip"] --> OUTRO["→ Outro"]
    DETECT -->|one| AUTO["Auto-select client"] --> INSTALL
    DETECT -->|multiple| PICKER["Client picker menu"] --> INSTALL
    INSTALL["Install / confirm MCP server"] --> OUTRO
```

---

## Outro flow

```mermaid
flowchart TD
    OUTRO["OutroScreen"] --> OUTCOME{Outcome?}
    OUTCOME -->|success| SUCCESS["Show changes, events, docs/continue URLs"]
    OUTCOME -->|error| ERR["Show error message"]
    OUTCOME -->|cancel| CANCEL["Show cancel message"]
    SUCCESS --> EXIT["Press key to exit"]
    ERR --> EXIT
    CANCEL --> EXIT
```
