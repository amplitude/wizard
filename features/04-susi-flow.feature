Feature: SUSI flow (Sign Up / Sign In)
  As a new or existing user
  I want to authenticate and select my org and project
  So that the wizard can connect to the right Amplitude account

  @todo
  Scenario: Existing user selects an existing org and existing project
    Given I am in the SUSI flow
    When I enter my email
    And I am identified as an existing user
    And I select an existing org from the picker
    And I select an existing project from the picker
    Then I should proceed to the Data Setup flow

  @todo
  Scenario: Existing user creates a new org
    Given I am in the SUSI flow
    When I enter my email
    And I am identified as an existing user
    And I select "Create new" from the org picker
    And I enter a name for the new org
    Then I should see the project picker for the new org

  @todo
  Scenario: Existing user creates a new project within an existing org
    Given I am in the SUSI flow
    When I enter my email
    And I am identified as an existing user
    And I select an existing org from the picker
    And I select "Create new" from the project picker
    And I enter a name for the new project
    Then I should proceed to the Data Setup flow

  @todo
  Scenario: New user signs up and joins an existing org, creates a new project
    Given I am in the SUSI flow
    When I enter my email
    And I am identified as a new user
    And I complete the sign up process
    And I select an existing org from the org picker
    And I select "Create new" from the project picker
    And I enter a name for the new project
    Then I should proceed to the Data Setup flow

  @todo
  Scenario: New user signs up and joins an existing org, selects an existing project
    Given I am in the SUSI flow
    When I enter my email
    And I am identified as a new user
    And I complete the sign up process
    And I select an existing org from the org picker
    And I select an existing project from the project picker
    Then I should proceed to the Data Setup flow

  @todo
  Scenario: New user signs up and creates a new org and project
    Given I am in the SUSI flow
    When I enter my email
    And I am identified as a new user
    And I complete the sign up process
    And I select "Create new" from the org picker
    And I enter a name for the new org
    And I select "Create new" from the project picker
    And I enter a name for the new project
    Then I should proceed to the Data Setup flow
