import { Given, When, Then, Before } from '@cucumber/cucumber';
import assert from 'node:assert';
import { WizardRouter } from '../../src/ui/tui/router.js';
import { Screen, Flow } from '../../src/ui/tui/flows.js';
import {
  buildSession,
  OutroKind,
  type WizardSession,
} from '../../src/lib/wizard-session.js';

// ── Shared state ──────────────────────────────────────────────────────────────

let router: WizardRouter;
let session: WizardSession;

function mockCredentials(): WizardSession['credentials'] {
  return {
    accessToken: 'access-abc',
    projectApiKey: 'api-key-xyz',
    host: 'https://api.amplitude.com',
    projectId: 123456,
  };
}

/** Advance past region + auth so the flow reaches DataSetup. */
function advancePastAuth(s: WizardSession): void {
  s.credentials = mockCredentials();
  s.region = 'us';
  s.selectedOrgId = 'org-1';
  s.selectedOrgName = 'Test Org';
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

Before(function () {
  router = new WizardRouter(Flow.Wizard);
  session = buildSession({});
  advancePastAuth(session);
});

// ── Given ─────────────────────────────────────────────────────────────────────

Given('the project has 50 or more ingested events', function () {
  session.activationLevel = 'full';
  session.projectHasData = true;
  session.snippetConfigured = true;
});

Given('the project has between 1 and 49 ingested events', function () {
  session.activationLevel = 'partial';
  session.projectHasData = false;
});

Given('the project has 0 ingested events', function () {
  session.activationLevel = 'none';
  session.projectHasData = false;
});

Given('the Amplitude snippet is configured', function () {
  session.snippetConfigured = true;
});

Given('the Amplitude snippet is not configured', function () {
  session.snippetConfigured = false;
});

Given('the app has been deployed', function () {
  // Deployment status is informational — routing is driven by activationLevel
});

Given('the app has not been deployed', function () {
  // Deployment status is informational — routing is driven by activationLevel
});

Given('I am at the "What would you like to do?" prompt', function () {
  session.activationLevel = 'partial';
  session.projectHasData = false;
  session.snippetConfigured = true;
  const screen = router.resolve(session);
  assert.strictEqual(
    screen,
    Screen.ActivationOptions,
    `Expected ActivationOptions but got ${screen}`,
  );
});

// ── When ──────────────────────────────────────────────────────────────────────

When('the activation check runs', function () {
  // activationLevel was set by the Given steps — the router resolves from it
});

When('I select {string}', function (choice: string) {
  switch (choice) {
    case 'help me test locally':
      // Routes to Framework Detection: complete activation options + reset to fresh project
      session.activationOptionsComplete = true;
      session.projectHasData = false;
      session.activationLevel = 'none';
      break;
    case "I'm done for now":
      session.outroData = {
        kind: OutroKind.Cancel,
        message: 'Come back once your app is deployed and sending events.',
      };
      break;
    case "I'm blocked":
      // Debug mode: complete activation options and proceed to the agent run
      session.activationOptionsComplete = true;
      session.debug = true;
      session.projectHasData = false;
      session.setupConfirmed = true;
      break;
    case 'take me to the docs':
      // Docs open in browser — screen stays; no session mutation
      break;
    default:
      throw new Error(`Unknown activation option: ${choice}`);
  }
});

// ── Then ──────────────────────────────────────────────────────────────────────

Then('I should proceed to the data check', function () {
  const screen = router.resolve(session);
  assert.strictEqual(
    screen,
    Screen.Options,
    `Expected Options (data check) but got ${screen}`,
  );
});

Then('I should be shown the "What would you like to do?" prompt', function () {
  const screen = router.resolve(session);
  assert.strictEqual(
    screen,
    Screen.ActivationOptions,
    `Expected ActivationOptions but got ${screen}`,
  );
});

Then('I should be taken to Framework Detection to set up the snippet', function () {
  const screen = router.resolve(session);
  assert.strictEqual(
    screen,
    Screen.Intro,
    `Expected Intro (Framework Detection) but got ${screen}`,
  );
});

Then('I should see a message to resume when data arrives', function () {
  assert.strictEqual(session.outroData?.kind, OutroKind.Cancel);
  assert.ok(session.outroData?.message, 'Expected a resume message');
});

Then('the Claude agent should run in debug mode', function () {
  assert.ok(session.debug, 'Expected session.debug to be true');
  const screen = router.resolve(session);
  assert.strictEqual(screen, Screen.Run, `Expected Run but got ${screen}`);
});
