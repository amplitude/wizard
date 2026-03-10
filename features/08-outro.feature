Feature: Outro
  As a developer
  I want to see a clear summary when the wizard finishes
  So that I know what was done and where to go next

  @todo
  Scenario: Successful agent run
    Given the agent run has completed successfully
    When I reach the Outro screen
    Then I should see a summary of changes made
    And I should see the events that were added
    And I should see links to docs and next steps
    When I press any key
    Then the wizard should exit

  @todo
  Scenario: Agent run errored
    Given the agent run has errored
    When I reach the Outro screen
    Then I should see an error message
    When I press any key
    Then the wizard should exit

  @todo
  Scenario: Wizard was cancelled
    Given the wizard was cancelled by the user
    When I reach the Outro screen
    Then I should see a cancellation message
    When I press any key
    Then the wizard should exit
