Feature: ampli.json project configuration
  As a developer
  I want the wizard to read and write ampli.json in my project directory
  So that my project stays connected to the right Amplitude source

  # Terminology: ampli.json uses `ProjectId` as the canonical key to identify
  # the Amplitude Project. Legacy files written by older versions of the
  # wizard (or the sibling ampli CLI) may still contain `WorkspaceId` — those
  # are auto-migrated to `ProjectId` at parse time, and `writeAmpliConfig`
  # only emits `ProjectId` going forward.

  Background:
    Given I am working in a project directory
  # ── Reading ampli.json ─────────────────────────────────────────────────────

  Scenario: No ampli.json present
    Given there is no "ampli.json" in the project directory
    When the wizard checks for an existing ampli.json
    Then the result should be "not_found"
    And the project should be considered unconfigured

  Scenario: Valid ampli.json with full configuration
    Given "ampli.json" exists in the project directory with content:
      """
      {
        "OrgId": "36958",
        "ProjectId": "0adfd673-c53b-462c-bf88-84c7605286a4",
        "SourceId": "478440ff-666e-4998-8278-84ff7488dfa1",
        "Branch": "main",
        "Path": "./src/ampli",
        "Version": "158.0.0",
        "Runtime": "node.js:typescript-ampli"
      }
      """
    When the wizard reads ampli.json
    Then the config should have OrgId "36958"
    And the config should have SourceId "478440ff-666e-4998-8278-84ff7488dfa1"
    And the project should be considered configured

  Scenario: Legacy ampli.json with WorkspaceId is auto-migrated to ProjectId
    # Back-compat: files written by older wizard versions or the ampli CLI
    # still use `WorkspaceId`. The wizard must read them transparently,
    # expose the value as `ProjectId` in the parsed config, and rewrite them
    # with `ProjectId` on the next save.
    Given "ampli.json" exists in the project directory with content:
      """
      {
        "OrgId": "36958",
        "WorkspaceId": "0adfd673-c53b-462c-bf88-84c7605286a4",
        "SourceId": "478440ff-666e-4998-8278-84ff7488dfa1",
        "Branch": "main",
        "Path": "./src/ampli"
      }
      """
    When the wizard reads ampli.json
    Then the config should have ProjectId "0adfd673-c53b-462c-bf88-84c7605286a4"
    And the config should not have a WorkspaceId field
    And the project should be considered configured
    When the wizard merges ampli.json with:
      | Version | 42.0.0 |
    Then "ampli.json" should contain ProjectId "0adfd673-c53b-462c-bf88-84c7605286a4"
    And "ampli.json" should not contain a WorkspaceId field

  Scenario: ampli.json exists but only has SourceId (minimal configuration)
    Given "ampli.json" exists in the project directory with content:
      """
      { "SourceId": "478440ff-666e-4998-8278-84ff7488dfa1" }
      """
    When the wizard reads ampli.json
    Then the project should be considered minimally configured
    But the project should not be considered fully configured

  Scenario: ampli.json is present but empty
    Given "ampli.json" exists in the project directory with content:
      """
      {}
      """
    When the wizard reads ampli.json
    Then the project should be considered unconfigured

  Scenario: ampli.json contains invalid JSON
    Given "ampli.json" exists in the project directory with content:
      """
      { OrgId: this is not valid json }
      """
    When the wizard reads ampli.json
    Then the result should be "invalid_json"
    And the project should be considered unconfigured

  Scenario: ampli.json has git merge conflicts
    Given "ampli.json" exists in the project directory with content:
      """
      <<<<<<< HEAD
      { "OrgId": "111" }
      =======
      { "OrgId": "222" }
      >>>>>>> feature-branch
      """
    When the wizard reads ampli.json
    Then the result should be "merge_conflicts"
    And the user should be warned about merge conflicts
  # ── Writing ampli.json ────────────────────────────────────────────────────

  Scenario: Wizard writes ampli.json after project setup
    Given there is no "ampli.json" in the project directory
    When the wizard writes ampli.json with:
      | OrgId     |                                36958 |
      | ProjectId | 0adfd673-c53b-462c-bf88-84c7605286a4 |
      | SourceId  | 478440ff-666e-4998-8278-84ff7488dfa1 |
      | Branch    | main                                 |
      | Path      | ./src/ampli                          |
      | Runtime   | node.js:typescript-ampli             |
    Then "ampli.json" should exist in the project directory
    And it should contain OrgId "36958"
    And it should contain SourceId "478440ff-666e-4998-8278-84ff7488dfa1"
    And it should contain ProjectId "0adfd673-c53b-462c-bf88-84c7605286a4"

  Scenario: Wizard updates an existing ampli.json without clobbering unrelated fields
    Given "ampli.json" exists in the project directory with content:
      """
      {
        "OrgId": "36958",
        "ProjectId": "0adfd673-c53b-462c-bf88-84c7605286a4",
        "Branch": "main",
        "Path": "./src/ampli"
      }
      """
    When the wizard merges ampli.json with:
      | SourceId  | 478440ff-666e-4998-8278-84ff7488dfa1 |
      | VersionId | 8ec607b1-0b09-4251-af84-95914f8e57e8 |
      | Version   |                               42.0.0 |
    Then "ampli.json" should contain OrgId "36958"
    And "ampli.json" should contain SourceId "478440ff-666e-4998-8278-84ff7488dfa1"
    And "ampli.json" should contain Version "42.0.0"
    And "ampli.json" should contain Path "./src/ampli"
  # ── Wizard flow integration ───────────────────────────────────────────────

  @todo
  Scenario: Wizard checks ampli.json before running the activation check
    Given I have valid credentials stored in "~/.ampli.json"
    And "ampli.json" is fully configured in the project directory
    When the wizard launches
    Then the activation check should use the SourceId from ampli.json

  @todo
  Scenario: Wizard skips to SUSI when ampli.json has no SourceId
    Given I have valid credentials stored in "~/.ampli.json"
    And there is no "ampli.json" in the project directory
    When the wizard launches
    Then I should go through the Data Setup flow to create a new source
