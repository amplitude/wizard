Feature: SUSI flow (Sign Up / Sign In)
  As a new or existing user
  I want to authenticate via OAuth and select my org and workspace
  So that the wizard can connect to the right Amplitude account

  # The SUSI flow runs inside AuthScreen. Authentication is OAuth-based —
  # bin.ts opens a browser and calls store.setOAuthComplete() when done.
  # AuthScreen shows a spinner while waiting, then drives org/workspace/API key selection.

  Scenario: OAuth completes — single org, single workspace, no saved API key
    Given the OAuth flow has completed with one org and one workspace
    And there is no saved API key for this project
    Then the org should be auto-selected
    And the workspace should be auto-selected
    And I should be prompted to enter my Amplitude API key

  Scenario: OAuth completes — multiple orgs, user selects one
    Given the OAuth flow has completed with multiple orgs
    Then I should see an org picker
    When I select an org
    Then that org should be stored in my session

  Scenario: OAuth completes — single org, multiple workspaces, user selects one
    Given the OAuth flow has completed with one org and multiple workspaces
    Then the org should be auto-selected
    And I should see a workspace picker
    When I select a workspace
    Then that workspace should be stored in my session

  Scenario: ampli.json is written after org and workspace are selected
    Given the OAuth flow has completed with one org and one workspace
    And there is no "ampli.json" in the project directory
    When the org and workspace are selected
    Then "ampli.json" should be written with OrgId, WorkspaceId, and Zone

  Scenario: API key is persisted after manual entry
    Given the OAuth flow has completed and org and workspace are selected
    And there is no saved API key for this project
    When I enter a valid Amplitude API key
    Then the API key should be saved to the system keychain or .env.local
    And I should proceed without being asked for the key again

  Scenario: Saved API key skips the API key prompt
    Given the OAuth flow has completed and org and workspace are selected
    And there is a saved API key for this project
    Then I should not be prompted to enter an API key
    And I should proceed automatically with the saved key

  Scenario: AuthScreen shows spinner while waiting for OAuth
    Given the wizard has launched
    And OAuth has not yet completed
    Then the AuthScreen should show a loading spinner

  Scenario: AuthScreen shows login URL when browser did not open
    Given the wizard has launched
    And the login URL is set in the session
    Then the AuthScreen should display the login URL for manual copy-paste

  @todo
  Scenario: OAuth fails — user is shown an error and can retry
    Given the wizard has launched
    When OAuth fails with a network error
    Then the user should see an error message
    And should be offered a way to retry

  Scenario: User belongs to no orgs — wizard shows guidance
    Given the OAuth flow has completed
    And the user has no Amplitude organizations
    Then the wizard should display guidance to create an org at app.amplitude.com
