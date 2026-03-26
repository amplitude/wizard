Feature: Data Setup flow
  As a user with a new project
  I want to configure my data and build my first analytics assets
  So that I can start getting value from Amplitude immediately

  # DataIngestionCheckScreen — polls until events arrive

  Scenario: DataIngestionCheck passes immediately for fully-activated users
    Given I am on the Checklist screen
    Then I should be on the Checklist screen

  Scenario: DataIngestionCheck shows while waiting for events
    Given I am on the DataIngestionCheck screen
    Then I should be on the DataIngestionCheck screen

  Scenario: DataIngestionCheck advances when events are detected
    Given I am on the DataIngestionCheck screen
    When events are detected in the project
    Then I should be on the Checklist screen

  # ChecklistScreen — first chart + first dashboard (taxonomy @todo)

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
    Then I should be on the Checklist screen

  Scenario: User skips checklist and continues to Slack
    Given I am on the Checklist screen
    When I select "Skip remaining and continue"
    Then I should be on the Slack screen

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

  # Direct GraphQL chart/dashboard creation — @todo (browser fallback is current MVP)

  @todo
  Scenario: Chart is created via GraphQL API when available
    Given I am on the Checklist screen
    And the Amplitude MCP is installed
    When I select "Create your first chart"
    Then a chart should be created via the Amplitude API
    And the chart should be marked as complete

  @todo
  Scenario: Dashboard is created via GraphQL API after chart
    Given I am on the Checklist screen
    And the chart is complete
    And the Amplitude MCP is installed
    When I select "Create your first dashboard"
    Then a dashboard should be created via the Amplitude API
    And the dashboard should be marked as complete
