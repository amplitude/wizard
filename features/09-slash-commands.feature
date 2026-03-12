Feature: Slash commands
  As a developer
  I want to run slash commands at any point during the wizard session
  So that I can change settings or trigger actions without restarting

  Scenario: /org switches the active org
    Given the wizard is active
    When I enter the slash command "/org"
    Then I should see the org picker
    And after selecting a new org the wizard should resume with the new context

  Scenario: /project switches the active project
    Given the wizard is active
    When I enter the slash command "/project"
    Then I should see the project picker for the current org
    And after selecting a new project the wizard should resume with the new context

  @todo
  Scenario: /login re-authenticates
    Given the wizard is active
    When I run "/login"
    Then I should go through the OAuth flow
    And after authenticating the wizard should resume

  Scenario: /logout clears credentials
    Given the wizard is active
    When I enter the slash command "/logout"
    Then the wizard should prompt me to log in again

  @todo
  Scenario: /whoami shows current session info
    Given the wizard is active
    And I am logged in as "user@example.com"
    When I run "/whoami"
    Then I should see my name, email, org, and project

  @todo
  Scenario: /overview opens the project in the browser
    Given the wizard is active
    When I run "/overview"
    Then the Amplitude project overview should open in my browser

  @todo
  Scenario: /chart sets up a new chart
    Given the wizard is active
    When I run "/chart"
    Then the chart creation flow should start

  @todo
  Scenario: /dashboard creates a new dashboard
    Given the wizard is active
    When I run "/dashboard"
    Then the dashboard creation flow should start

  @todo
  Scenario: /taxonomy interacts with the taxonomy agent
    Given the wizard is active
    When I run "/taxonomy"
    Then the taxonomy agent should start

  @todo
  Scenario: /help lists available commands
    Given the wizard is active
    When I run "/help"
    Then I should see a list of all available slash commands with descriptions
