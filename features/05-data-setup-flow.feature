Feature: Data Setup flow
  As a user with a new project
  I want to configure my data and build my first analytics assets
  So that I can start getting value from Amplitude immediately
  # DataIngestionCheckScreen — polls until events arrive

  Scenario: DataIngestionCheck is skipped for fully-activated users
    Given I have completed MCP setup on a fully-activated project
    Then I should be on the Checklist screen

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
    Then I should be on the Checklist screen

  Scenario: User exits from DataIngestionCheck
    Given I am on the DataIngestionCheck screen
    When I press "q" to exit
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
    Then I should be on the Checklist screen

  Scenario: In CI mode, data ingestion check is skipped
    Given I am running in CI mode
    And I am on the DataIngestionCheck screen
    Then I should be on the DataIngestionCheck screen

  # ChecklistScreen — first chart + first dashboard (taxonomy @todo)
  # On mount the checklist queries Amplitude for existing charts and dashboards
  # owned by the user, and pre-populates completed items so a returning user
  # does not repeat steps they have already done.
  # Note: detection is org-scoped (Thunder has no project-level listing API);
  # for a new-project user this is equivalent to project-scoped.

  Scenario: Checklist shows after data is confirmed
    Given I am on the Checklist screen
    Then I should be on the Checklist screen

  Scenario: Dashboard is locked until chart is complete
    Given I am on the Checklist screen
    And the chart is not yet complete
    Then "Create your first dashboard" should be disabled

  Scenario: Dashboard unlocks after chart is complete
    Given I am on the Checklist screen
    And the chart is complete
    Then the dashboard item should be unlocked

  Scenario: User skips checklist and continues to Slack
    Given I am on the Checklist screen
    When I select "Skip remaining and continue"
    Then I should be on the Slack screen

  Scenario: All checklist items complete
    Given I am on the Checklist screen
    And the chart is complete
    And the dashboard is complete
    When I select "Done — continue"
    Then I should be on the Slack screen

  Scenario: Returning user with existing charts sees chart pre-marked as complete
    Given I am on the Checklist screen
    And the user already has charts in their Amplitude org
    Then "Create your first chart" should be shown as complete
    And the dashboard item should be unlocked

  Scenario: Returning user with existing charts and dashboards sees full checklist pre-populated
    Given I am on the Checklist screen
    And the user already has charts in their Amplitude org
    And the user already has dashboards in their Amplitude org
    Then "Create your first chart" should be shown as complete
    And the dashboard should be marked as complete
  # Taxonomy agent — @todo (in progress in parallel)

  @todo
  Scenario: Taxonomy agent item appears as locked in checklist
    Given I am on the Checklist screen
    Then "Set up taxonomy" should be shown as locked

  @todo
  Scenario: Taxonomy agent runs from checklist when implemented
    Given I am on the Checklist screen
    When I select "Set up taxonomy"
    Then the taxonomy agent should run
    And taxonomy should be marked as complete on the checklist
  # Direct GraphQL chart/dashboard creation (browser deep-link is current MVP)

  Scenario: Chart is created via GraphQL API when available
    Given I am on the Checklist screen
    When I select "Create your first chart"
    Then a chart should be created via the Amplitude API
    And the chart should be marked as complete

  Scenario: A chart has been created
    Given I am on the Checklist screen
    And a chart has already been created
    And no dashboard has been created yet
    Then "Create your first chart" should be shown as complete
    And the dashboard item should be unlocked

  Scenario: Dashboard is created via GraphQL API after chart
    Given I am on the Checklist screen
    And the chart is complete
    When I select "Create your first dashboard"
    Then a dashboard should be created via the Amplitude API
    And the dashboard should be marked as complete
