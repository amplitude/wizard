Feature: Outro
  As a developer
  I want to see a clear summary when the wizard finishes
  So that I know what was done and where to go next

  Scenario: Successful agent run
    Given the agent run has completed successfully
    Then I should reach the Outro screen
    And I should see a summary of changes made
    And I should see the events that were added
    And I should see links to docs and next steps

  Scenario: Agent run errored
    Given the agent run has errored
    Then I should reach the Outro screen
    And I should see an error message

  Scenario: Wizard was cancelled
    Given the wizard was cancelled by the user
    Then I should reach the Outro screen
    And I should see a cancellation message
