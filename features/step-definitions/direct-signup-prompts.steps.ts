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

let projectDir: string;
let router: WizardRouter;
let session: WizardSession;

Before(function () {
  projectDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ampli-signup-prompts-test-'),
  );
  router = new WizardRouter(Flow.Wizard);
  session = buildSession({ installDir: projectDir });
});

After(function () {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

// ── Given ─────────────────────────────────────────────────────────────────

Given(
  'the wizard is launched with --signup and no email or full-name',
  function () {
    session = buildSession({
      installDir: projectDir,
      signup: true,
      // signupEmail and signupFullName intentionally omitted → both null
    });
  },
);

Given(
  'the wizard is launched with --signup and only an email supplied',
  function () {
    session = buildSession({
      installDir: projectDir,
      signup: true,
      signupEmail: 'test@example.com',
      // signupFullName intentionally omitted → null
    });
  },
);

Given(
  'the wizard is launched with --signup, email, and full-name all supplied',
  function () {
    session = buildSession({
      installDir: projectDir,
      signup: true,
      signupEmail: 'test@example.com',
      signupFullName: 'Test User',
    });
  },
);

Given('the intro is concluded and region is selected', function () {
  session.introConcluded = true;
  session.region = 'us';
});

// ── When ──────────────────────────────────────────────────────────────────

When('the user enters their full name', function () {
  // Simulate what SignupFullNameScreen writes to the session on submit.
  session.signupFullName = 'Test User';
});

When('the user enters their email', function () {
  // Simulate what SignupEmailScreen writes to the session on submit.
  session.signupEmail = 'test@example.com';
});

// ── Then ──────────────────────────────────────────────────────────────────

Then('the router should resolve to the SignupFullName screen', function () {
  assert.strictEqual(
    router.resolve(session),
    Screen.SignupFullName,
    `Expected SignupFullName screen but got ${router.resolve(session)}`,
  );
});

Then('the router should resolve to the SignupEmail screen', function () {
  assert.strictEqual(
    router.resolve(session),
    Screen.SignupEmail,
    `Expected SignupEmail screen but got ${router.resolve(session)}`,
  );
});

Then('the router should resolve to the Auth screen', function () {
  assert.strictEqual(
    router.resolve(session),
    Screen.Auth,
    `Expected Auth screen but got ${router.resolve(session)}`,
  );
});

Then('the SignupFullName screen should be skipped', function () {
  // The router resolves to Auth directly — SignupFullName is not shown because
  // signupFullName is already populated.
  const resolved = router.resolve(session);
  assert.notStrictEqual(
    resolved,
    Screen.SignupFullName,
    'Expected SignupFullName to be skipped (already have full name)',
  );
});

Then('the SignupEmail screen should be skipped', function () {
  // The router resolves to Auth directly — SignupEmail is not shown because
  // signupEmail is already populated.
  const resolved = router.resolve(session);
  assert.notStrictEqual(
    resolved,
    Screen.SignupEmail,
    'Expected SignupEmail to be skipped (already have email)',
  );
});
