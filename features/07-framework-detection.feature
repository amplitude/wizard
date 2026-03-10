Feature: Framework Detection
  As a developer
  I want the wizard to detect or let me choose my framework
  So that the agent can instrument my app correctly

  @todo
  Scenario: Framework is auto-detected and user confirms
    Given I am in the Framework Detection flow
    When the wizard successfully auto-detects my framework
    Then I should see the detected framework displayed
    When I confirm the detection
    And there are no unresolved setup questions
    Then I should proceed to the Agent Run

  @todo
  Scenario: Framework is auto-detected and user cancels
    Given I am in the Framework Detection flow
    When the wizard successfully auto-detects my framework
    Then I should see the detected framework displayed
    When I cancel
    Then the wizard should exit

  @todo
  Scenario: Framework detection fails and user selects from picker
    Given I am in the Framework Detection flow
    When the wizard cannot auto-detect my framework
    Then I should see the framework picker menu
    When I select a framework from the picker
    Then I should see the selected framework displayed
    When I confirm
    And there are no unresolved setup questions
    Then I should proceed to the Agent Run

  @todo
  Scenario: Framework selected via --menu flag
    Given I run the wizard with the "--menu" flag
    Then I should see the framework picker menu without attempting auto-detection

  @todo
  Scenario: Setup questions are all auto-detectable
    Given I am in the Framework Detection flow
    And my framework has setup questions
    When I confirm the detected framework
    And all setup questions can be auto-detected
    Then the answers should be filled in automatically
    And I should proceed to the Agent Run without being prompted

  @todo
  Scenario: Setup questions require user input
    Given I am in the Framework Detection flow
    And my framework has setup questions
    When I confirm the detected framework
    And some setup questions cannot be auto-detected
    Then I should see a picker for each undetected question
    When I answer all questions
    Then I should proceed to the Agent Run
