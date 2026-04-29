Feature: Inline "Create new project…" flow
  As a user authenticated with Amplitude
  I want to create a new project from the CLI without leaving the wizard
  So that I can instrument a brand-new app end-to-end without switching to the browser

  # The flow is triggered from two places in AuthScreen (project picker +
  # environment picker) and from the /create-project slash command. It mounts
  # a dedicated CreateProjectScreen that POSTs to {proxyBase}/projects, stores
  # the returned apiKey via setCredentials(), and advances the router.

  Scenario: Entering create-project from the project picker
    Given the user is authenticated with an org selected
    When the user picks "Create new project…" from the project picker
    Then the router should resolve to the CreateProject screen
    And the session.createProject.pending flag should be true

  Scenario: Cancelling create-project returns to the Auth picker
    Given the user is on the CreateProject screen
    When the user cancels
    Then the router should resolve back to the Auth screen
    And the session.createProject.pending flag should be false

  Scenario: Successful create advances past Auth
    Given the user is on the CreateProject screen
    When the create-project call succeeds and credentials are set
    Then the router should resolve past Auth toward the agent flow

  @todo
  Scenario: NAME_TAKEN error stays on the screen for retry
    Given the user is on the CreateProject screen
    When the create-project call returns NAME_TAKEN
    Then the CreateProject screen should remain active
    And the user should be able to retry with a different name

  @todo
  Scenario: QUOTA_REACHED falls back to the browser deep-link
    Given the user is on the CreateProject screen
    When the create-project call returns QUOTA_REACHED
    Then the CreateProject screen should offer a fallback link to Amplitude settings

  @todo
  Scenario: FORBIDDEN guides the user to ask an admin
    Given the user is on the CreateProject screen
    When the create-project call returns FORBIDDEN
    Then the CreateProject screen should tell the user to ask an admin

  Scenario: --project-name in CI mode with no existing projects requires the flag
    Given the wizard is invoked in CI mode without --project-name
    And no project has an API key
    Then the wizard should exit with code 2 and stderr should mention --project-name
