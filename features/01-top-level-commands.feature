Feature: Top-level CLI commands
  As a developer
  I want to manage my Amplitude authentication and wizard from the command line
  So that I can control my session without entering the full wizard
  # TODO: after OAuth completes, show an org selector so the user can pick which
  # org to set as active (instead of silently defaulting to the first org returned
  # by the API). Store the selected org in ./ampli.json alongside the token.

  @todo
  Scenario: Login with no stored credentials
    Given I have no credentials stored in "./ampli.json"
    When I run "amplitude-wizard login"
    Then I should be redirected through the OAuth flow
    And I should be prompted to select an org
    And my token should be stored in "./ampli.json"
    And I should see my logged-in user detailsy

  Scenario: Login with valid stored credentials
    Given I have valid credentials stored in "./ampli.json"
    When I run "amplitude-wizard login"
    Then I should see my logged-in user details
    And the OAuth flow should not be triggered

  Scenario: Login with expired stored credentials
    Given I have expired credentials stored in "./ampli.json"
    When I run "amplitude-wizard login"
    Then I should be redirected through the OAuth flow
    And my token should be refreshed in "./ampli.json"

  Scenario: Logout
    Given I have credentials stored in "./ampli.json"
    When I run "amplitude-wizard logout"
    Then "./ampli.json" should be cleared

  Scenario: Whoami when logged in
    Given I have valid credentials stored in "./ampli.json"
    When I run "amplitude-wizard whoami"
    Then I should see my name, email, and zone

  Scenario: Whoami when not logged in
    Given I have no credentials stored in "./ampli.json"
    When I run "amplitude-wizard whoami"
    Then I should see "Not logged in"

  Scenario: Wizard in CI mode
    When I run "amplitude-wizard --ci --api-key abc123 --install-dir /tmp/app"
    Then the wizard should run non-interactively
    And authentication should come from the provided arguments

  Scenario: Wizard in default interactive mode
    When I run "amplitude-wizard"
    Then the interactive TUI should launch
