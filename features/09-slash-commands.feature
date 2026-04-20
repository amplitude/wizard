Feature: Slash commands
  As a developer
  I want to run slash commands at any point during the wizard session
  So that I can change settings or trigger actions without restarting

  @todo
  Scenario: /login re-authenticates
    Given the wizard is active
    When I enter the slash command "/login"
    Then I should go through the OAuth flow
    And after authenticating the wizard should resume

  Scenario: /logout clears credentials
    Given the wizard is active
    When I enter the slash command "/logout"
    Then the wizard should prompt me to log in again

  Scenario: /region mid-session forces re-authentication against the new zone
    Given I have just authenticated
    When I enter the slash command "/region"
    Then I should be taken back to region selection
    When I select the "eu" region
    Then the wizard should prompt me to log in again

  Scenario: /slack opens Amplitude settings to connect Slack
    Given the wizard is active
    When I enter the slash command "/slack"
    Then I should see feedback about opening Amplitude settings for Slack

  Scenario: /whoami shows current session info
    Given the wizard is active
    And my org is "acme" and my workspace is "prod" and my region is "us"
    When I enter the slash command "/whoami"
    Then I should see my org, workspace, and region

  @todo
  Scenario: /overview opens the project in the browser
    Given the wizard is active
    When I enter the slash command "/overview"
    Then the Amplitude project overview should open in my browser

  @todo
  Scenario: /chart sets up a new chart
    Given the wizard is active
    When I enter the slash command "/chart"
    Then the chart creation flow should start

  @todo
  Scenario: /dashboard creates a new dashboard
    Given the wizard is active
    When I enter the slash command "/dashboard"
    Then the dashboard creation flow should start

  @todo
  Scenario: /taxonomy interacts with the taxonomy agent
    Given the wizard is active
    When I enter the slash command "/taxonomy"
    Then the taxonomy agent should start

  Scenario: /feedback records the user message
    Given the wizard is active
    When I enter the slash command "/feedback love this tool"
    Then the recorded slash feedback message should be "love this tool"
