Feature: --signup missing-field prompts in the TUI
  As a user invoking the wizard with --signup
  I want the TUI to collect any missing fields (full name, email) before Auth
  So that I can complete signup without re-running the CLI with extra flags

  # The SignupFullName and SignupEmail screens are injected into the Wizard
  # flow between RegionSelect and Auth. They appear only when --signup is set
  # and the corresponding flag was not supplied on the command line.
  # Once both fields are populated the router skips both screens and proceeds
  # directly to Auth.

  Scenario: --signup with no email or full-name prompts for full name first, then email
    Given the wizard is launched with --signup and no email or full-name
    And the intro is concluded and region is selected
    Then the router should resolve to the SignupFullName screen
    When the user enters their full name
    Then the router should resolve to the SignupEmail screen
    When the user enters their email
    Then the router should resolve to the Auth screen

  Scenario: --signup with email supplied but no full-name prompts for full name only
    Given the wizard is launched with --signup and only an email supplied
    And the intro is concluded and region is selected
    Then the router should resolve to the SignupFullName screen
    When the user enters their full name
    Then the router should resolve to the Auth screen

  Scenario: --signup with all fields supplied goes straight to Auth
    Given the wizard is launched with --signup, email, and full-name all supplied
    And the intro is concluded and region is selected
    Then the router should resolve to the Auth screen
    And the SignupFullName screen should be skipped
    And the SignupEmail screen should be skipped
