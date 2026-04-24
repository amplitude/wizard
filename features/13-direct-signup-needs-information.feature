Feature: --signup with server-driven field collection
  As a user running `npx @amplitude/wizard --signup`
  I want the wizard to send what it has and let the server decide what else
  is required
  So that I only get asked for fields the backend actually needs

  # Coverage model. These scenarios exercise the router + session state
  # transitions that `SigningUpScreen` drives via the store. We don't boot
  # the TUI or mock HTTP — that layer is covered by router/unit tests. The
  # BDD here asserts the four user-journey shapes the flow must support:
  #
  # 1. --signup only: email screen → signing-up → name screen → signing-up
  # 2. --signup --email: signing-up → name screen → signing-up
  # 3. --signup + both fields: straight to signing-up (no collection screens)
  # 4. requires_redirect: signing-up → abandoned → Auth
  #
  # "First POST" / "second POST" are represented by the SigningUpScreen
  # being resolved by the router; the screen's useEffect is what actually
  # fires `performSignupOrAuth`. We simulate the server response by writing
  # its effect back onto the session (setSignupRequiredFields / setSignupAuth
  # / setSignupAbandoned), then re-resolve the router.

  Scenario: --signup with no other flags — two POSTs, two collection screens
    Given the wizard is started with --signup and no email or full name
    And the intro is concluded and region is "us"
    When the router resolves
    Then it should land on the SignupEmail screen
    When the user submits the email "jane@example.com"
    And the router resolves
    Then it should land on the SigningUp screen
    When the first signup POST returns needs_information for "full_name"
    And the router resolves
    Then it should land on the SignupFullName screen
    When the user submits the full name "Jane Doe"
    And the router resolves
    Then it should land on the SigningUp screen
    When the second signup POST returns a success payload
    And the router resolves
    Then it should advance past SigningUp to Auth

  Scenario: --signup --email only — one collection screen, two POSTs
    Given the wizard is started with --signup and email "jane@example.com"
    And the intro is concluded and region is "us"
    When the router resolves
    Then it should land on the SigningUp screen
    When the first signup POST returns needs_information for "full_name"
    And the router resolves
    Then it should land on the SignupFullName screen
    When the user submits the full name "Jane Doe"
    And the router resolves
    Then it should land on the SigningUp screen
    When the second signup POST returns a success payload
    And the router resolves
    Then it should advance past SigningUp to Auth

  Scenario: --signup with both email and full name — one POST, no collection screens
    Given the wizard is started with --signup, email "jane@example.com", and full name "Jane Doe"
    And the intro is concluded and region is "us"
    When the router resolves
    Then it should land on the SigningUp screen
    And the SignupEmail screen should not have been resolved
    And the SignupFullName screen should not have been resolved
    When the first signup POST returns a success payload
    And the router resolves
    Then it should advance past SigningUp to Auth

  Scenario: requires_redirect — fall through to browser OAuth
    Given the wizard is started with --signup and email "existing@acme.com"
    And the intro is concluded and region is "us"
    When the router resolves
    Then it should land on the SigningUp screen
    When the first signup POST returns requires_redirect
    Then session.signupAbandoned becomes true
    When the router resolves
    Then it should advance past SigningUp to Auth
