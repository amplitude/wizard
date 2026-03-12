Feature: Org / Project Selection
  As a user
  I want to select or create an org and project
  So that the wizard operates on the correct Amplitude account context

  Background:
    Given I am in the Org / Project Selection flow

  Scenario: Select an existing org and existing project
    When I select an existing org from the org picker
    And I select an existing project from the project picker
    Then I should continue with the selected org and project

  Scenario: Create a new org
    When I select "Create new" from the org picker
    And I enter a name for the new org
    Then the new org should be created
    And I should see the project picker

  Scenario: Select existing org and create a new project
    When I select an existing org from the org picker
    And I select "Create new" from the project picker
    And I enter a name for the new project
    Then the new project should be created
    And I should continue with the selected org and new project

  Scenario: Create a new org and a new project
    When I select "Create new" from the org picker
    And I enter a name for the new org
    And I select "Create new" from the project picker
    And I enter a name for the new project
    Then both the new org and project should be created
    And I should continue with the new org and project

  Scenario: Invoked via /org slash command
    Given the wizard is active at any screen
    When I enter the slash command "/org"
    Then I should see the org picker
    And after selecting, the data check should re-run for the new context

  Scenario: Invoked via /project slash command
    Given the wizard is active at any screen
    When I enter the slash command "/project"
    Then I should see the project picker for the current org
    And after selecting, the data check should re-run for the new context
