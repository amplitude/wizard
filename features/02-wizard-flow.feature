Feature: Wizard flow
  As a developer
  I want the wizard to guide me from authentication through instrumentation
  So that I can get Amplitude set up without manual configuration

  Scenario: New user — wizard starts with the intro screen
    Given I have no credentials stored in "~/.ampli.json"
    When the wizard launches
    Then I should see the IntroScreen

  Scenario: After continuing past intro, wizard proceeds to region selection
    Given I have no credentials stored in "~/.ampli.json"
    When the wizard launches
    And I continue past the intro
    Then I should be asked to select a region

  Scenario: After region selection, wizard proceeds to authentication
    Given I have no credentials stored in "~/.ampli.json"
    When the wizard launches
    And I continue past the intro
    And I select the "US" region
    Then the US region should be stored in my session
    And I should go through the SUSI flow

  Scenario: Signup flow requires email capture before ToS
    Given I have no credentials stored in "~/.ampli.json"
    When the wizard launches with "--auth-onboarding create-account"
    And I continue past the intro
    And I select the "US" region
    Then I should be on the EmailCaptureScreen
    When I enter my email address
    Then I should be on the ToSScreen

  Scenario: Signup flow requires explicit ToS acceptance
    Given I have no credentials stored in "~/.ampli.json"
    When the wizard launches with "--auth-onboarding create-account"
    And I continue past the intro
    And I select the "US" region
    And I enter my email address
    Then I should be on the ToSScreen
    When I accept the Terms of Service
    Then I should go through the SUSI flow

  Scenario: Signup flow can be cancelled from ToS screen
    Given I have no credentials stored in "~/.ampli.json"
    When the wizard launches with "--auth-onboarding create-account"
    And I continue past the intro
    And I select the "US" region
    And I enter my email address
    And I am on the ToSScreen
    When I decline the Terms of Service
    Then I should be taken to the Outro with a cancel state

  Scenario: Email is pre-filled from --signup-email flag
    Given I have no credentials stored in "~/.ampli.json"
    When the wizard launches with "--auth-onboarding create-account --email test@example.com"
    And I continue past the intro
    And I select the "US" region
    Then I should be on the EmailCaptureScreen
    And the email field should be pre-filled with "test@example.com"

  Scenario: Existing customer email detected during signup offers login option
    Given I have no credentials stored in "~/.ampli.json"
    When the wizard launches with "--auth-onboarding create-account"
    And I continue past the intro
    And I select the "US" region
    And I enter an email that belongs to an existing customer
    Then I should see the "Account already exists" message
    And I should be offered options to log in or use a different email

  Scenario: Existing customer chooses to log in instead
    Given I have no credentials stored in "~/.ampli.json"
    When the wizard launches with "--auth-onboarding create-account"
    And I continue past the intro
    And I select the "US" region
    And I enter an email that belongs to an existing customer
    And I choose to "Log in with existing account"
    Then the signup flow should switch to regular auth
    And I should go through the login flow

  Scenario: Existing customer chooses to use a different email
    Given I have no credentials stored in "~/.ampli.json"
    When the wizard launches with "--auth-onboarding create-account"
    And I continue past the intro
    And I select the "US" region
    And I enter an email that belongs to an existing customer
    And I choose to "Use a different email"
    Then I should be back at email entry
    And I can enter a new email address

  Scenario: After SUSI completes — wizard advances to Data Setup then Agent Run
    Given I have no credentials stored in "~/.ampli.json"
    When the wizard launches
    And I continue past the intro
    And I select the "US" region
    Then I should go through the SUSI flow
    When the Data Setup check runs
    Then the project should have no existing data
    And I should be on the RunScreen

  Scenario: Returning user also sees the intro screen first
    Given I have valid credentials stored in "~/.ampli.json"
    When the wizard launches
    Then I should see the IntroScreen

  Scenario: Returning user confirms intro and proceeds to region selection
    Given I have valid credentials stored in "~/.ampli.json"
    When the wizard launches
    And I continue past the intro
    Then I should be asked to select a region

  Scenario: Returning user confirms region and proceeds to Data Setup
    Given I have valid credentials stored in "~/.ampli.json"
    When the wizard launches
    And I continue past the intro
    And I select the "US" region
    Then I should proceed to the Data Setup flow

  Scenario: /region slash command re-triggers region selection and re-auth
    Given the wizard is active
    When I enter the slash command "/region"
    Then I should be taken back to region selection
    When I select the "EU" region
    Then the wizard should prompt me to log in again

  Scenario: "Change region" on the intro re-triggers region selection and re-auth
    Given I have valid credentials stored in "~/.ampli.json"
    When the wizard launches
    And I pick "Change region" on the intro
    Then I should be taken back to region selection
    When I select the "EU" region
    Then the wizard should prompt me to log in again

  Scenario: Returning user with credentials and existing data — goes to MCP then Slack
    Given I have valid credentials stored in "~/.ampli.json"
    And the current project has existing data
    And my region is already set to "us"
    When the wizard launches
    And I continue past the intro
    Then I should be on the MCP screen

  Scenario: User with existing data (full activation) skips agent run — goes straight to MCP
    Given I have valid credentials stored in "~/.ampli.json"
    And the current project has existing data
    And my region is already set to "us"
    When the wizard launches
    And I continue past the intro
    Then I should be on the MCP screen

  Scenario: After MCP, wizard waits for data ingestion then advances to Slack
    Given I have reached the RunScreen
    When the Claude agent completes successfully
    And MCP setup is complete
    Then I should be on the DataIngestionCheck screen
    When events are detected in the project
    Then I should still be on the DataIngestionCheck screen
    When I press Enter to confirm events
    Then I should be on the Slack screen

  Scenario: Full-activation user passes DataIngestionCheck immediately and reaches Slack
    Given I have valid credentials stored in "~/.ampli.json"
    And the current project has existing data
    And my region is already set to "us"
    When the wizard launches
    And I continue past the intro
    And MCP setup is complete
    Then I should be on the Slack screen

  Scenario: User exits DataIngestionCheck and returns later
    Given I am on the DataIngestionCheck screen
    When I press "x" to exit
    Then I should be taken to the Outro with a cancel state

  Scenario: Run screen is shown before the agent starts
    Given I have reached the RunScreen
    Then I should be on the RunScreen

  Scenario: MCP setup screen appears after a successful agent run
    Given I have reached the RunScreen
    When the Claude agent completes successfully
    Then I should be on the MCP screen

  Scenario: Slack setup screen appears after data ingestion confirmed
    Given I have reached the RunScreen
    When the Claude agent completes successfully
    And MCP setup is complete
    And events are detected in the project
    And I press Enter to confirm events
    Then I should be on the Slack screen

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

