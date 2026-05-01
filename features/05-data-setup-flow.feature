Feature: Data Setup flow
  As a user with a new project
  I want to verify my events are flowing and see my analytics dashboard
  So that I can start getting value from Amplitude immediately
  # DataIngestionCheckScreen — polls until events arrive

  Scenario: DataIngestionCheck is skipped for fully-activated users
    Given I have completed MCP setup on a fully-activated project
    Then I should be on the Slack screen

  Scenario: DataIngestionCheck shows while waiting for events
    Given I am on the DataIngestionCheck screen
    Then I should be on the DataIngestionCheck screen

  Scenario: DataIngestionCheck shows event preview when events are detected
    Given I am on the DataIngestionCheck screen
    When events are detected in the project
    Then I should still be on the DataIngestionCheck screen

  Scenario: DataIngestionCheck advances after user confirms events
    Given I am on the DataIngestionCheck screen
    When events are detected in the project
    And I press Enter to confirm events
    Then I should be on the Slack screen

  Scenario: User exits from DataIngestionCheck
    Given I am on the DataIngestionCheck screen
    When I press "x" to exit
    Then I should be taken to the Outro with a cancel state

  # Agent mode — data ingestion is polled automatically after SDK installation.
  # No user confirmation required; session.dataIngestionConfirmed is set on detection.
  # CI mode skips the check entirely.

  Scenario: In agent mode, events are confirmed automatically when detected
    Given I am in agent mode
    When events are detected in the project
    Then data ingestion is confirmed automatically

  Scenario: In agent mode, data ingestion confirmation skips the Enter prompt
    Given I am in agent mode
    And I am on the DataIngestionCheck screen
    When events are detected in the project
    Then I should be on the Slack screen

  Scenario: In CI mode, data ingestion check is skipped
    Given I am running in CI mode
    And I am on the DataIngestionCheck screen
    Then I should be on the DataIngestionCheck screen

  # Agent-created dashboard — the agent creates charts and a dashboard during
  # the conclude phase and writes .amplitude-dashboard.json with the URL.
  # The wizard surfaces this URL in the Outro so users can open it directly.

  Scenario: Agent-created dashboard URL is shown in the Outro
    Given the agent run has completed successfully
    And the agent created a dashboard at "https://app.amplitude.com/123/dashboard/abc"
    Then I should reach the Outro screen
    And I should see the dashboard URL "https://app.amplitude.com/123/dashboard/abc"

  Scenario: Outro links directly to agent-created dashboard
    Given the agent run has completed successfully
    And the agent created a dashboard at "https://app.amplitude.com/123/dashboard/abc"
    Then the "Open your analytics dashboard" action should open the dashboard URL

  Scenario: Outro falls back to Amplitude overview when no dashboard was created
    Given the agent run has completed successfully
    And no dashboard was created by the agent
    Then the "Open Amplitude" action should open the Amplitude overview
