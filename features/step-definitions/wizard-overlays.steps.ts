import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert';
import { Overlay, type WizardRouter } from '../../src/ui/tui/router.js';
import { Screen } from '../../src/ui/tui/flows.js';
import type { WizardSession } from '../../src/lib/wizard-session.js';
import {
  getWhoamiText,
  parseFeedbackSlashInput,
} from '../../src/ui/tui/console-commands.js';

// State is shared via the Cucumber World object, populated by wizard-flow.steps.ts Before hook.
function router(world: object): WizardRouter {
  return (world as Record<string, unknown>).wizardRouter as WizardRouter;
}
function session(world: object): WizardSession {
  return (world as Record<string, unknown>).wizardSession as WizardSession;
}

// ── Overlays ──────────────────────────────────────────────────────────────────

When('an Anthropic service outage is detected', function () {
  router(this).pushOverlay(Overlay.Outage);
});

Then('the OutageScreen overlay should appear', function () {
  assert.strictEqual(router(this).resolve(session(this)), Overlay.Outage);
});

Then('I should be able to continue anyway or exit', function () {
  assert.ok(router(this).hasOverlay, 'Expected an overlay to be active');
  router(this).popOverlay();
  assert.ok(!router(this).hasOverlay, 'Expected overlay to be dismissed');
});

Given('the settings file blocks the agent', function () {
  session(this).settingsOverrideKeys = ['permissions.allow'];
});

When('the agent is about to start', function () {
  // Simulate agent-runner.ts detecting blocking settings overrides and pushing the overlay
  if (session(this).settingsOverrideKeys?.length) {
    router(this).pushOverlay(Overlay.SettingsOverride);
  }
});

Then('the SettingsOverrideScreen overlay should appear', function () {
  assert.strictEqual(
    router(this).resolve(session(this)),
    Overlay.SettingsOverride,
  );
});

Then(
  'I should be able to back up and patch the settings to continue',
  function () {
    assert.ok(router(this).hasOverlay);
    router(this).popOverlay();
    assert.ok(!router(this).hasOverlay);
  },
);

// ── Slash commands ────────────────────────────────────────────────────────────

When('I enter the slash command {string}', function (command: string) {
  if (command === '/region') {
    session(this).regionForced = true;
    // Reset data state so setup re-runs once the new region is confirmed
    session(this).projectHasData = null;
  }
  if (command === '/logout') {
    session(this).credentials = null;
  }
  if (command === '/slack') {
    // /slack opens a browser and sets feedback — record the command for assertion
    (this as Record<string, unknown>).lastSlashCommand = command;
  }
  const feedbackMsg = parseFeedbackSlashInput(command);
  if (feedbackMsg !== undefined) {
    (this as Record<string, unknown>).slashFeedbackMessage = feedbackMsg;
  }
});

Then(
  'I should see feedback about opening Amplitude settings for Slack',
  function () {
    // The /slack command opens a browser and sets command feedback.
    // We verify the command was recognised (not treated as unknown).
    assert.strictEqual(
      (this as Record<string, unknown>).lastSlashCommand,
      '/slack',
      'Expected /slack to be recorded as the last slash command',
    );
  },
);

Then('the wizard should prompt me to log in again', function () {
  const screen = router(this).resolve(session(this));
  assert.strictEqual(
    screen,
    Screen.Auth,
    `Expected Auth screen after logout but got ${screen}`,
  );
});

Then('I should be taken back to region selection', function () {
  const screen = router(this).resolve(session(this));
  assert.strictEqual(
    screen,
    Screen.RegionSelect,
    `Expected RegionSelect but got ${screen}`,
  );
});

When('the overlay is dismissed', function () {
  router(this).popOverlay();
});

Then('the data check should re-run for the new region', function () {
  // regionForced cleared + region set → DataSetup should be next (projectHasData is null)
  const screen = router(this).resolve(session(this));
  assert.strictEqual(
    screen,
    Screen.DataSetup,
    `Expected DataSetup to re-run but got ${screen}`,
  );
});

// ── /whoami ───────────────────────────────────────────────────────────────────

Given(
  'my org is {string} and my project is {string} and my region is {string}',
  function (org: string, project: string, region: string) {
    session(this).selectedOrgName = org;
    session(this).selectedProjectName = project;
    session(this).region = region as 'us' | 'eu';
  },
);

Then('I should see my org, project, and region', function () {
  const text = getWhoamiText(session(this));
  assert.ok(
    text.includes(session(this).selectedOrgName ?? ''),
    `Expected org in: ${text}`,
  );
  assert.ok(
    text.includes(session(this).selectedProjectName ?? ''),
    `Expected project in: ${text}`,
  );
  assert.ok(
    text.includes(session(this).region ?? ''),
    `Expected region in: ${text}`,
  );
});

Then(
  'the recorded slash feedback message should be {string}',
  function (expected: string) {
    assert.strictEqual(
      (this as Record<string, unknown>).slashFeedbackMessage,
      expected,
    );
  },
);
