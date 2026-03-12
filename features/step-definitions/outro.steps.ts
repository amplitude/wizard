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
  // Advance past auth, region, data setup, intro, setup, run, mcp
  session.credentials = {
    accessToken: 'tok',
    projectApiKey: 'key',
    host: 'https://api.amplitude.com',
    projectId: 0,
  };
  session.region = 'us';
  session.projectHasData = false;
  session.setupConfirmed = true;
  session.mcpComplete = true;
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

Then('I should see a cancellation message', function () {
  assert.strictEqual(
    session.outroData?.kind,
    OutroKind.Cancel,
    'Expected outroData.kind to be Cancel',
  );
  assert.ok(session.outroData?.message, 'Expected outroData.message to be set');
});
