import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WizardRouter } from '../../src/ui/tui/router.js';
import { Screen, Flow } from '../../src/ui/tui/flows.js';
import {
  buildSession,
  type WizardSession,
} from '../../src/lib/wizard-session.js';

// ── Shared state ──────────────────────────────────────────────────────────
//
// We mirror the store/router relationship by:
//   1. Building a session with the flag shape `buildSession` produces for
//      the given CLI args (signup / signupEmail / signupFullName).
//   2. Calling router.resolve(session) at each "And the router resolves"
//      step. Every resolve is recorded in `screensSeen` so we can assert
//      things like "SignupEmail was never resolved".
//   3. Simulating the server response by writing its side-effects onto
//      the session the same way SigningUpScreen does via the store
//      (setSignupRequiredFields / setSignupAuth / setSignupAbandoned).
//
// HTTP is not mocked. The router/session transitions *are* the flow — the
// SigningUpScreen's POST is triggered by the router mounting that screen,
// and the flow predicates in `flows.ts` decide what renders next based on
// what the response wrote back to the session.

let projectDir: string;
let router: WizardRouter;
let session: WizardSession;
let screensSeen: Screen[];

Before(function () {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ampli-signup-test-'));
  router = new WizardRouter(Flow.Wizard);
  session = buildSession({ installDir: projectDir });
  screensSeen = [];
});

After(function () {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

// ── Given ─────────────────────────────────────────────────────────────────

Given(
  'the wizard is started with --signup and no email or full name',
  function () {
    session.signup = true;
    session.signupEmail = null;
    session.signupFullName = null;
  },
);

Given(
  'the wizard is started with --signup and email {string}',
  function (email: string) {
    session.signup = true;
    session.signupEmail = email;
    session.signupFullName = null;
  },
);

Given(
  'the wizard is started with --signup, email {string}, and full name {string}',
  function (email: string, fullName: string) {
    session.signup = true;
    session.signupEmail = email;
    session.signupFullName = fullName;
  },
);

Given(
  'the intro is concluded and region is {string}',
  function (region: string) {
    session.introConcluded = true;
    session.region = region as WizardSession['region'];
  },
);

// ── When ──────────────────────────────────────────────────────────────────

When('the router resolves', function () {
  const resolved = router.resolve(session);
  screensSeen.push(resolved);
});

When('the user submits the email {string}', function (email: string) {
  // Mirrors store.setSignupEmail — what SignupEmailScreen calls on submit.
  session.signupEmail = email;
});

When('the user submits the full name {string}', function (fullName: string) {
  // Mirrors store.setSignupFullName (trimmed).
  session.signupFullName = fullName.trim();
});

When(
  'the first signup POST returns needs_information for {string}',
  function (field: string) {
    // Mirrors what SigningUpScreen does on a needs_information response
    // with a known, unmet field: store.setSignupRequiredFields([...]).
    session.signupRequiredFields = [field];
  },
);

When('the second signup POST returns a success payload', function () {
  applySuccess();
});

When('the first signup POST returns a success payload', function () {
  applySuccess();
});

When('the first signup POST returns requires_redirect', function () {
  // Mirrors SigningUpScreen's abandonAfterHold path: the terminal-hold
  // timer fires setSignupAbandoned(true). For router purposes, the hold
  // is a presentational delay — the flow-level effect is the abandon bit.
  session.signupAbandoned = true;
});

// ── Then ──────────────────────────────────────────────────────────────────

Then('it should land on the SignupEmail screen', function () {
  const last = screensSeen[screensSeen.length - 1];
  assert.strictEqual(
    last,
    Screen.SignupEmail,
    `Expected SignupEmail, got ${last}`,
  );
});

Then('it should land on the SigningUp screen', function () {
  const last = screensSeen[screensSeen.length - 1];
  assert.strictEqual(last, Screen.SigningUp, `Expected SigningUp, got ${last}`);
});

Then('it should land on the SignupFullName screen', function () {
  const last = screensSeen[screensSeen.length - 1];
  assert.strictEqual(
    last,
    Screen.SignupFullName,
    `Expected SignupFullName, got ${last}`,
  );
});

Then('it should advance past SigningUp to Auth', function () {
  const last = screensSeen[screensSeen.length - 1];
  assert.strictEqual(last, Screen.Auth, `Expected Auth, got ${last}`);
});

Then('the SignupEmail screen should not have been resolved', function () {
  assert.ok(
    !screensSeen.includes(Screen.SignupEmail),
    `SignupEmail was unexpectedly resolved; saw: ${screensSeen.join(', ')}`,
  );
});

Then('the SignupFullName screen should not have been resolved', function () {
  assert.ok(
    !screensSeen.includes(Screen.SignupFullName),
    `SignupFullName was unexpectedly resolved; saw: ${screensSeen.join(', ')}`,
  );
});

Then('session.signupAbandoned becomes true', function () {
  assert.strictEqual(session.signupAbandoned, true);
});

// ── Helpers ───────────────────────────────────────────────────────────────

function applySuccess(): void {
  // Mirrors SigningUpScreen's success arm: store.setSignupAuth(result).
  session.signupAuth = {
    kind: 'success',
    idToken: 'id-token',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    zone: 'us',
    userInfo: null,
  };
}
