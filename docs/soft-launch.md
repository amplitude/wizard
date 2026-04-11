# Soft Launch — Scope & Implementation Plan

> **Status: COMPLETED** — All features described as "temporarily disabled" below
> have been re-enabled. McpScreen, SlackScreen, and ChecklistScreen are live in
> the wizard flow with their standard `show` predicates. The `/mcp` and `/slack`
> slash commands are available. This document is retained for historical context.

What needs to work, what gets temporarily disabled, and how to cut scope with
minimal code changes.

---

## MVP scope

The soft launch delivers the core value loop: authenticate → pick a project →
install the SDK → instrument events → verify data flows.

### Must work (in order)

| Step | Screen/Feature | What it does |
|------|---------------|-------------|
| 1 | **Sign up / Sign in** | OAuth PKCE flow → `~/.ampli.json` token storage |
| 2 | **Project picker** | Org → workspace → environment selection, auto-resolves API key |
| 3 | **Install SDK** | Agent installs the Amplitude SDK, adds initialization code |
| 4 | **Baseline events** | Agent discovers instrumentable locations, calls `confirm_event_plan`, writes `track()` calls |
| 5 | **Event listener** | DataIngestionCheckScreen polls the activation API until events arrive |

### Temporarily disabled

| Feature | Screen(s) | Why cut |
|---------|-----------|---------|
| **MCP server installation** | McpScreen, `/mcp` slash command, `mcp add`/`mcp remove` CLI subcommands | Nice-to-have; not part of core instrumentation loop |
| **Slack integration** | SlackScreen, `/slack` slash command, `slack` CLI subcommand | Nice-to-have; can be done manually in Amplitude settings |
| **Charts & dashboards** | ChecklistScreen | Web UI chart/dashboard creation not ready; OutroScreen already links to Amplitude |

### What stays after disabling

```
IntroScreen → RegionSelectScreen → AuthScreen → DataSetupScreen →
  [ActivationOptionsScreen if partial] → SetupScreen → RunScreen →
  DataIngestionCheckScreen → OutroScreen
```

The user exits with events flowing and a link to open Amplitude. MCP, Slack, and
checklist screens are silently skipped by the router.

---

## Implementation

### Approach: flow predicates + feature flags

The cleanest way to cut scope is through the existing flow pipeline. Each screen
has a `show()` predicate — returning `false` makes the router skip it entirely.
No state management, agent runner, or post-agent step changes are needed.

### 1. Disable screens in `flows.ts` (3 lines)

`src/ui/tui/flows.ts` — modify the `show` predicate for three entries:

```typescript
// McpScreen entry — currently shows when runPhase !== Error
show: () => false,  // MVP: disabled

// ChecklistScreen entry — currently shows when runPhase !== Error
show: () => false,  // MVP: disabled

// SlackScreen entry — currently shows when runPhase !== Error
show: () => false,  // MVP: disabled
```

**Why this works:** The router walks the flow pipeline sequentially. When `show()`
returns `false`, the screen is skipped. Downstream screens don't depend on upstream
`*Complete` flags from disabled screens. The flow advances naturally:
RunScreen → DataIngestionCheckScreen → OutroScreen.

### 2. Hide slash commands in `console-commands.ts` (2 lines)

`src/ui/tui/console-commands.ts` — remove or comment out:

```typescript
// Remove these entries from the COMMANDS array:
{ slug: 'mcp', description: '...' },
{ slug: 'slack', description: '...' },
```

Users won't see `/mcp` or `/slack` in the help list or be able to invoke them.

### 3. Gate CLI subcommands in `bin.ts`

Two options:

**Option A — Feature flag gate (recommended, reversible):**

```typescript
.command('mcp [action]', 'Manage MCP server', (yargs) => { ... }, async (argv) => {
  if (!isFlagEnabled('FLAG_MCP_SERVER')) {
    console.log('MCP setup is coming soon.');
    process.exit(0);
  }
  // ... existing code
})
```

Same pattern for the `slack` subcommand.

**Option B — Remove subcommands entirely (simpler, harder to re-enable):**

Delete the `.command('mcp', ...)` block (~88 lines) and `.command('slack', ...)`
block (~48 lines) from `bin.ts`.

### 4. No other changes needed

These components work correctly without changes:

| Component | Why it's safe |
|-----------|---------------|
| **agent-runner.ts** | Post-agent section doesn't trigger MCP, Slack, or checklist. Comment at line ~397 confirms: "MCP installation is handled by McpScreen" |
| **WizardStore** | `setMcpComplete()`, `setSlackComplete()`, `setChecklistComplete()` are only called by their respective screens. If screens don't render, setters never fire |
| **OutroScreen** | Shows agent changes + event plan + link to Amplitude. Doesn't reference MCP, Slack, or checklist |
| **DataIngestionCheckScreen** | Polls activation API every 30s. Independent of all disabled features |
| **CI mode** | Has no screens — runs agent and exits. MCP/Slack/Checklist were never part of CI flow |
| **Standalone flows** | `Flow.McpAdd`, `Flow.McpRemove`, `Flow.SlackSetup` only launch from CLI subcommands. Gating subcommands prevents these flows |

---

## Verification checklist

After making changes, verify each MVP step end-to-end:

### Sign up / Sign in
- [ ] Fresh user: OAuth opens browser, redirects to `localhost:13222`, token stored
- [ ] Returning user: token read from `~/.ampli.json`, auth skipped
- [ ] `--signup` flag forces new account creation flow
- [ ] Region selection works (US/EU)

### Project picker
- [ ] Single org → auto-selected
- [ ] Multiple orgs → picker shown
- [ ] Single workspace → auto-selected
- [ ] Multiple workspaces → picker shown
- [ ] API key resolved from selected environment

### Install SDK
- [ ] Agent installs correct SDK for detected framework (test: Next.js, Python, generic)
- [ ] Initialization code added to correct entry point
- [ ] Environment variables set via wizard-tools MCP (`set_env_values`)
- [ ] `.env.local` created with API key, `.gitignore` updated

### Baseline events
- [ ] Agent calls `load_skill_menu` → `install_skill` → reads SKILL.md
- [ ] Agent discovers events and calls `confirm_event_plan`
- [ ] User can approve, skip, or give feedback on the plan
- [ ] Agent writes `track()` calls only after approval
- [ ] Event plan shown in RunScreen "Event plan" tab

### Event listener
- [ ] DataIngestionCheckScreen appears after agent completes
- [ ] Polls activation API every 30 seconds
- [ ] Shows "Events detected!" when data arrives
- [ ] User can exit early with q/Esc and return later
- [ ] Advances to OutroScreen on confirmation

### Disabled features don't surface
- [ ] McpScreen never appears in flow
- [ ] SlackScreen never appears in flow
- [ ] ChecklistScreen never appears in flow
- [ ] `/mcp` and `/slack` slash commands not listed in help
- [ ] `amplitude-wizard mcp add` shows "coming soon" or is removed
- [ ] `amplitude-wizard slack` shows "coming soon" or is removed
- [ ] OutroScreen doesn't reference charts, dashboards, or MCP

### Edge cases
- [ ] Returning user with existing Amplitude install: pre-detected choice still works (skip or re-run)
- [ ] Agent failure: OutroScreen shows error kind, no reference to skipped features
- [ ] Outage overlay still works (Claude API down → show status, offer exit)
- [ ] CI mode: `--ci --install-dir . --api-key KEY` works end-to-end without disabled features interfering

---

## Re-enabling features

When ready to launch each feature:

1. **MCP**: Revert `show()` to original predicate in flows.ts, restore slash command, remove feature flag gate from `bin.ts`
2. **Slack**: Same pattern — revert `show()`, restore slash command, remove gate
3. **Charts/Dashboards**: Revert `show()` on ChecklistScreen. Requires web UI chart/dashboard creation to be functional

Each feature can be re-enabled independently. The flow pipeline handles ordering
automatically — no routing changes needed.

---

## Risk assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Agent fails to install SDK for a framework | Medium | 18 framework configs + 34 integration skills. Test the top 3-5 frameworks (Next.js, Python, React) before launch |
| OAuth token expired mid-session | Low | Login overlay (`/login`) handles refresh. Existing retry logic in agent-runner |
| Event ingestion takes too long | Medium | DataIngestionCheckScreen has a "continue without waiting" escape. Events typically appear within 1-2 minutes |
| User expects MCP/Slack/Charts | Low | OutroScreen links to Amplitude web UI where all features are available manually |
| LLM proxy outage | Low | Health check system detects this pre-run. OutageOverlay shows status page links |
