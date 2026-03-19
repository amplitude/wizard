Feature: Slack Integration
  As a developer
  I want to connect my Amplitude project to Slack
  So that I get chart previews, dashboard sharing, and tracking plan notifications

  Scenario: Slack setup screen appears in wizard flow after MCP
    Given I have reached the RunScreen
    When the Claude agent completes successfully
    And MCP setup is complete
    Then I should be on the Slack screen

  Scenario: Slack setup is skipped when agent run errors
    Given I have reached the RunScreen
    When the Claude agent errors
    Then I should be taken to the Outro with an error state

  Scenario: User skips Slack setup — proceeds to Outro
    Given I am on the Slack setup screen
    When I skip the Slack setup
    Then the Slack flow should advance to the Outro screen

  Scenario: User completes Slack setup — proceeds to Outro
    Given I am on the Slack setup screen
    When I complete the Slack setup
    Then the Slack flow should advance to the Outro screen

  Scenario: EU region shows correct Slack app name
    Given I am on the Slack setup screen
    And my region is "eu"
    Then the Slack app name should be "Amplitude - EU"

  Scenario: US region shows standard Slack app name
    Given I am on the Slack setup screen
    And my region is "us"
    Then the Slack app name should be "Amplitude"

  Scenario: Standalone slack command launches SlackSetup flow
    Given I run the standalone slack command
    Then I should be on the standalone Slack setup screen

  @todo
  Scenario: Returning user with existing data sees Slack setup after MCP
    Given I have valid credentials stored in "~/.ampli.json"
    And the current project has existing data
    And MCP setup is complete
    Then I should be on the Slack screen

  @todo
  Scenario: Returning user skips Slack setup — proceeds to Outro
    Given I am a returning user on the Slack setup screen
    When I skip the Slack setup
    Then the Slack flow should advance to the Outro screen

  @todo
  Scenario: Returning user completes Slack setup — proceeds to Outro
    Given I am a returning user on the Slack setup screen
    When I complete the Slack setup
    Then the Slack flow should advance to the Outro screen
