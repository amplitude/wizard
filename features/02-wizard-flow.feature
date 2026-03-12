Feature: Wizard flow
  As a developer
  I want the wizard to guide me from authentication through instrumentation
  So that I can get Amplitude set up without manual configuration

  Scenario: New user — wizard starts with region selection
    Given I have no credentials stored in "~/.ampli.json"
    When the wizard launches
    Then I should be asked to select a region

  Scenario: After region selection, wizard proceeds to authentication
    Given I have no credentials stored in "~/.ampli.json"
    When the wizard launches
    And I select the "US" region
    Then the US region should be stored in my session
    And I should go through the SUSI flow

  Scenario: After SUSI completes — wizard advances to Data Setup
    Given I have no credentials stored in "~/.ampli.json"
    When the wizard launches
    And I select the "US" region
    Then I should go through the SUSI flow
    When I should go through the Data Setup flow
    Then the project should have no existing data
    And I should be taken to Framework Detection

  Scenario: Returning user also sees region selection first
    Given I have valid credentials stored in "~/.ampli.json"
    When the wizard launches
    Then I should be asked to select a region

  Scenario: Returning user confirms region and proceeds to Data Setup
    Given I have valid credentials stored in "~/.ampli.json"
    When the wizard launches
    And I select the "US" region
    Then I should proceed to the Data Setup flow

  Scenario: /region slash command re-triggers region selection and data setup
    Given the wizard is active
    When I enter the slash command "/region"
    Then I should be taken back to region selection
    When I select the "EU" region
    Then the data check should re-run for the new region

  Scenario: Returning user with credentials and existing data — options menu
    Given I have valid credentials stored in "~/.ampli.json"
    And the current project has existing data
    And my region is already set to "us"
    When the wizard launches
    Then I should see options to open overview, chart, dashboard, taxonomy agent, or switch org or project

  Scenario: Agent run completes successfully
    Given I have reached the RunScreen
    When the Claude agent completes successfully
    Then environment variables should be uploaded to hosting
    And I should be taken to the Outro

  Scenario: Agent run fails
    Given I have reached the RunScreen
    When the Claude agent errors
    Then I should be taken to the Outro with an error state

  Scenario: Stripe feature discovered during agent run
    Given I have reached the RunScreen
    And the project has Stripe as a dependency
    When the Claude agent runs
    Then I should see a Stripe tip

  Scenario: LLM feature discovered during agent run
    Given I have reached the RunScreen
    And the project has an LLM SDK as a dependency
    When the Claude agent runs
    Then I should see an LLM tip

  Scenario: Outage overlay appears
    Given the wizard is active
    When an Anthropic service outage is detected
    Then the OutageScreen overlay should appear
    And I should be able to continue anyway or exit

  Scenario: Settings override overlay appears
    Given the wizard is active
    And the settings file blocks the agent
    Then the SettingsOverrideScreen overlay should appear
    And I should be able to back up and patch the settings to continue

