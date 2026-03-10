Feature: Wizard flow
  As a developer
  I want the wizard to guide me from authentication through instrumentation
  So that I can get Amplitude set up without manual configuration

  @todo
  Scenario: New user with no credentials and no data
    Given I have no credentials stored in "~/.ampli.json"
    When the wizard launches
    Then I should go through the SUSI flow
    And I should go through the Data Setup flow
    And the project should have no existing data
    And I should be taken to Framework Detection

  @todo
  Scenario: Returning user with credentials and no data
    Given I have valid credentials stored in "~/.ampli.json"
    When the wizard launches
    Then I should go through the Activation Check flow
    And the project should have no existing data
    And I should be taken to Framework Detection

  @todo
  Scenario: Returning user with credentials and existing data — setting up new project
    Given I have valid credentials stored in "~/.ampli.json"
    And the current project has existing data
    When the wizard launches
    Then I should be asked "Setting up a new project?"
    When I answer "yes"
    Then I should go through Org / Project Selection
    And the data check should re-run for the new project

  @todo
  Scenario: Returning user with credentials and existing data — continuing with current project
    Given I have valid credentials stored in "~/.ampli.json"
    And the current project has existing data
    When the wizard launches
    Then I should be asked "Setting up a new project?"
    When I answer "no"
    Then I should see options to open overview, chart, dashboard, taxonomy agent, or switch org/project

  @todo
  Scenario: Switching org or project from the options menu
    Given I am on the options menu for an existing project
    When I select "switch org or project"
    Then I should go through Org / Project Selection
    And the data check should re-run for the newly selected project

  @todo
  Scenario: Agent run completes successfully
    Given I have reached the RunScreen
    When the Claude agent completes successfully
    Then environment variables should be uploaded to hosting
    And I should be taken to the Outro

  @todo
  Scenario: Agent run fails
    Given I have reached the RunScreen
    When the Claude agent errors
    Then I should be taken to the Outro with an error state

  @todo
  Scenario: Stripe feature discovered during agent run
    Given I have reached the RunScreen
    And the project has Stripe as a dependency
    When the Claude agent runs
    Then I should see a Stripe tip

  @todo
  Scenario: LLM feature discovered during agent run
    Given I have reached the RunScreen
    And the project has an LLM SDK as a dependency
    When the Claude agent runs
    Then I should see an LLM tip

  @todo
  Scenario: Outage overlay appears
    Given the wizard is active
    When an Anthropic service outage is detected
    Then the OutageScreen overlay should appear
    And I should be able to continue anyway or exit

  @todo
  Scenario: Settings override overlay appears
    Given the wizard is active
    And ".claude/settings.json" contains keys that block the agent
    Then the SettingsOverrideScreen overlay should appear
    And I should be able to back up and patch the settings to continue

  @todo
  Scenario: /org slash command during wizard
    Given the wizard is active at any screen
    When I run "/org"
    Then I should be taken through Org / Project Selection

  @todo
  Scenario: /project slash command during wizard
    Given the wizard is active at any screen
    When I run "/project"
    Then I should be taken through Org / Project Selection
