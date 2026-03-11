import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert';
import { Overlay, type WizardRouter } from '../../src/ui/tui/router.js';
import { Screen } from '../../src/ui/tui/flows.js';
import type { WizardSession } from '../../src/lib/wizard-session.js';

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

Then('the SettingsOverrideScreen overlay should appear', function () {
  router(this).pushOverlay(Overlay.SettingsOverride);
  assert.strictEqual(router(this).resolve(session(this)), Overlay.SettingsOverride);
});

Then('I should be able to back up and patch the settings to continue', function () {
  assert.ok(router(this).hasOverlay);
  router(this).popOverlay();
  assert.ok(!router(this).hasOverlay);
});

// ── Slash commands ────────────────────────────────────────────────────────────

When('I enter the slash command {string}', function (command: string) {
  if (command === '/org' || command === '/project') {
    session(this).orgProjectForced = true;
    session(this).orgProjectComplete = false;
  }
});

Then('I should reach Org and Project Selection', function () {
  const screen = router(this).resolve(session(this));
  assert.strictEqual(
    screen,
    Screen.OrgProject,
    `Expected OrgProject but got ${screen}`,
  );
});
