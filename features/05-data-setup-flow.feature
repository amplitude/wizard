Feature: Data Setup flow
  As a user with a new project
  I want to configure my data and build my first analytics assets
  So that I can start getting value from Amplitude immediately

  @todo
  Scenario: User chooses the data onboarding wizard and events are ingested
    Given a new project has been created
    When I select "data onboarding wizard"
    And I complete the data setup configuration
    And events are successfully ingested
    Then I should see the checklist with taxonomy, first chart, and first dash

  @todo
  Scenario: User chooses the data onboarding wizard and events are not ingested
    Given a new project has been created
    When I select "data onboarding wizard"
    And I complete the data setup configuration
    And events are not successfully ingested
    Then I should be returned to the wizard flow data check

  @todo
  Scenario: User chooses the taxonomy agent directly
    Given a new project has been created
    When I select "taxonomy agent"
    Then the taxonomy agent should run
    And I should see the checklist with taxonomy marked as complete

  @todo
  Scenario: User completes taxonomy agent from the checklist
    Given I am on the post-ingest checklist
    And taxonomy is not yet complete
    When I select "run taxonomy agent"
    Then the taxonomy agent should run
    And taxonomy should be marked as complete on the checklist

  @todo
  Scenario: User creates first chart from the checklist
    Given I am on the post-ingest checklist
    And the chart is not yet complete
    When I select "create first chart"
    Then the first chart should be created
    And the chart should be marked as complete on the checklist
    And "create first dash" should become available

  @todo
  Scenario: First dash is locked until chart is complete
    Given I am on the post-ingest checklist
    And the chart is not yet complete
    Then "create first dash" should be shown as locked

  @todo
  Scenario: User creates first dash after chart is complete
    Given I am on the post-ingest checklist
    And the chart is complete
    When I select "create first dash"
    Then the first dashboard should be created
    And the dash should be marked as complete on the checklist

  @todo
  Scenario: User completes all three checklist items
    Given I am on the post-ingest checklist
    And taxonomy, chart, and dash are all complete
    Then I should see the option to open the dashboard in the browser
    When I select "open dashboard in browser"
    Then my Amplitude dashboard should open in the browser
    And I should be returned to the wizard flow
