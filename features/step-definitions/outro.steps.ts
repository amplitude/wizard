import { Given, Then, Before } from '@cucumber/cucumber';
import assert from 'node:assert';
import { WizardRouter } from '../../src/ui/tui/router.js';
import { Screen, Flow } from '../../src/ui/tui/flows.js';
import {
  buildSession,
  type WizardSession,
  RunPhase,
  OutroKind,
} from '../../src/lib/wizard-session.js';

// ── Shared state ──────────────────────────────────────────────────────────────

let router: WizardRouter;
let session: WizardSession;

// ── Lifecycle ─────────────────────────────────────────────────────────────────

Before(function () {
  router = new WizardRouter(Flow.Wizard);
  session = buildSession({});
  // Advance past intro, auth, region, data setup, setup, run, mcp, data ingestion, checklist, slack
  session.introConcluded = true;
  session.credentials = {
    accessToken: 'tok',
    projectApiKey: 'key',
    host: 'https://api.amplitude.com',
    appId: 0,
  };
  session.selectedOrgName = 'Test Org';
  session.selectedProjectName = 'Default';
  session.selectedEnvName = 'Default';
  session.region = 'us';
  session.projectHasData = false;
  session.setupConfirmed = true;
  session.mcpComplete = true;
  session.dataIngestionConfirmed = true;
  session.slackComplete = true;
});

// ── Given ─────────────────────────────────────────────────────────────────────

Given('the agent run has completed successfully', function () {
  session.runPhase = RunPhase.Completed;
  session.outroData = {
    kind: OutroKind.Success,
    message: 'Amplitude SDK installed successfully.',
    changes: ['Added amplitude package', 'Created track events'],
    docsUrl: 'https://amplitude.com/docs',
    continueUrl: 'https://app.amplitude.com',
  };
});

Given('the agent run has errored', function () {
  session.runPhase = RunPhase.Error;
  session.outroData = {
    kind: OutroKind.Error,
    message: 'The agent encountered an error.',
  };
});

Given('the agent run has errored with an authentication failure', function () {
  session.runPhase = RunPhase.Error;
  session.credentials = null;
  session.outroData = {
    kind: OutroKind.Error,
    message:
      'Authentication failed\n\nYour Amplitude session has expired. Please run the wizard again to log in.',
    promptLogin: true,
    canRestart: true,
  };
});

Given('the wizard was cancelled by the user', function () {
  session.runPhase = RunPhase.Error;
  session.outroData = {
    kind: OutroKind.Cancel,
    message: 'Wizard cancelled.',
  };
});

// ── When ──────────────────────────────────────────────────────────────────────

// "When I reach the Outro screen" is verified by the Then steps below.

// ── Then ──────────────────────────────────────────────────────────────────────

Then('I should reach the Outro screen', function () {
  const screen = router.resolve(session);
  assert.strictEqual(screen, Screen.Outro, `Expected Outro but got ${screen}`);
});

Then('I should see a summary of changes made', function () {
  assert.ok(
    session.outroData?.changes && session.outroData.changes.length > 0,
    'Expected outroData.changes to be populated',
  );
});

Then('I should see the events that were added', function () {
  assert.ok(
    session.outroData?.changes,
    'Expected outroData.changes to list added events',
  );
});

Then('I should see links to docs and next steps', function () {
  assert.ok(session.outroData?.docsUrl, 'Expected outroData.docsUrl to be set');
});

Then('I should see an error message', function () {
  assert.strictEqual(
    session.outroData?.kind,
    OutroKind.Error,
    'Expected outroData.kind to be Error',
  );
  assert.ok(session.outroData?.message, 'Expected outroData.message to be set');
});

Then('The existing credentials should be cleared', function () {
  assert.strictEqual(
    session.credentials,
    null,
    'Expected credentials to be cleared (null)',
  );
});

Then('I should be prompted to log in again', function () {
  assert.strictEqual(
    session.outroData?.promptLogin,
    true,
    'Expected outroData.promptLogin to be true',
  );
});

Then('I should be able to restart the agent run', function () {
  assert.strictEqual(
    session.outroData?.canRestart,
    true,
    'Expected outroData.canRestart to be true',
  );
});

Then('I should see a cancellation message', function () {
  assert.strictEqual(
    session.outroData?.kind,
    OutroKind.Cancel,
    'Expected outroData.kind to be Cancel',
  );
  assert.ok(session.outroData?.message, 'Expected outroData.message to be set');
});

Given('the agent created a dashboard at {string}', function (url: string) {
  session.checklistDashboardUrl = url;
});

Given('no dashboard was created by the agent', function () {
  session.checklistDashboardUrl = null;
});

Then('I should see the dashboard URL {string}', function (url: string) {
  assert.strictEqual(
    session.checklistDashboardUrl,
    url,
    `Expected checklistDashboardUrl to be ${url}`,
  );
});

Then(
  'the {string} action should open the dashboard URL',
  function (label: string) {
    assert.strictEqual(
      label,
      'Open your analytics dashboard',
      'Expected label to be "Open your analytics dashboard"',
    );
    assert.ok(
      session.checklistDashboardUrl,
      'Expected checklistDashboardUrl to be set when this action is shown',
    );
  },
);

Then(
  'the {string} action should open the Amplitude overview',
  function (label: string) {
    assert.strictEqual(
      label,
      'Open Amplitude',
      'Expected label to be "Open Amplitude"',
    );
    assert.strictEqual(
      session.checklistDashboardUrl,
      null,
      'Expected checklistDashboardUrl to be null when falling back to overview',
    );
  },
);
