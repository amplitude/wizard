Feature: Activation Check
  As a returning user
  I want the wizard to evaluate my project's activation status
  So that I am routed to the right next step based on my instrumentation progress

  @todo
  Scenario: Project is fully activated (50+ events)
    Given I have valid credentials stored in "./ampli.json"
    And the project has 50 or more ingested events
    When the activation check runs
    Then I should proceed to the data check

  @todo
  Scenario: Project is onboarded but not activated (1–49 events) with snippet configured and app deployed
    Given I have valid credentials stored in "./ampli.json"
    And the project has between 1 and 49 ingested events
    And the Amplitude snippet is configured
    And the app has been deployed
    When the activation check runs
    Then I should be shown the "What would you like to do?" prompt

  @todo
  Scenario: Project is onboarded but not activated (1–49 events) with snippet configured and app not deployed
    Given I have valid credentials stored in "./ampli.json"
    And the project has between 1 and 49 ingested events
    And the Amplitude snippet is configured
    And the app has not been deployed
    When the activation check runs
    Then I should be shown the "What would you like to do?" prompt

  @todo
  Scenario: Project has no events and snippet is not configured
    Given I have valid credentials stored in "./ampli.json"
    And the project has 0 ingested events
    And the Amplitude snippet is not configured
    When the activation check runs
    Then I should be taken to Framework Detection to set up the snippet
    And afterwards I should be shown the "What would you like to do?" prompt

  @todo
  Scenario: User chooses to test locally
    Given I am at the "What would you like to do?" prompt
    When I select "help me test locally"
    Then I should be taken to Framework Detection

  @todo
  Scenario: User chooses to exit and resume later
    Given I am at the "What would you like to do?" prompt
    When I select "I'm done for now"
    Then the wizard should exit
    And I should see a message to resume when data arrives

  @todo
  Scenario: User chooses debug mode
    Given I am at the "What would you like to do?" prompt
    When I select "I'm blocked"
    Then the Claude agent should run in debug mode

  @todo
  Scenario: User opens docs and prompt stays open
    Given I am at the "What would you like to do?" prompt
    When I select "take me to the docs"
    Then the docs should open in my browser
    And the "What would you like to do?" prompt should remain open
