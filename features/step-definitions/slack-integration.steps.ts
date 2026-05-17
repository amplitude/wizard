import { Given, When, Then, Before } from '@cucumber/cucumber';
import assert from 'node:assert';
import { WizardRouter } from '../../src/ui/tui/router.js';
import { Screen, Flow } from '../../src/ui/tui/flows.js';
import {
  RunPhase,
  OutroKind,
  SlackOutcome,
  type CloudRegion,
  type WizardSession,
} from '../../src/lib/wizard-session.js';
import { advancePastAuth, newRouterAndSession } from '../support/helpers.js';

// ── Shared state ──────────────────────────────────────────────────────────────

let router: WizardRouter;
let session: WizardSession;

/** Advance past intro, auth, region, data setup, framework detection, run, mcp — lands on Slack. */
function advancePastMcp(s: WizardSession): void {
  advancePastAuth(s);
  s.setupConfirmed = true;
  s.runPhase = RunPhase.Completed;
  s.outroData = { kind: OutroKind.Success };
  s.mcpComplete = true;
  s.dataIngestionConfirmed = true;
  s.checklistComplete = true;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

Before(function () {
  ({ router, session } = newRouterAndSession());
});

// ── Given ─────────────────────────────────────────────────────────────────────

Given('I am on the Slack setup screen', function () {
  advancePastMcp(session);
  const screen = router.resolve(session);
  assert.strictEqual(screen, Screen.Slack, `Expected Slack but got ${screen}`);
});

Given('my region is {string}', function (region: string) {
  session.region = region.toLowerCase() as CloudRegion;
});

Given('I run the standalone slack command', function () {
  ({ router, session } = newRouterAndSession({ flow: Flow.SlackSetup }));
});

// ── When ──────────────────────────────────────────────────────────────────────

When('I skip the Slack setup', function () {
  session.slackComplete = true;
  session.slackOutcome = SlackOutcome.Skipped;
});

When('I complete the Slack setup', function () {
  session.slackComplete = true;
  session.slackOutcome = SlackOutcome.Configured;
});

// ── Then ──────────────────────────────────────────────────────────────────────

Then('the Slack flow should advance to the Outro screen', function () {
  const screen = router.resolve(session);
  assert.strictEqual(screen, Screen.Outro, `Expected Outro but got ${screen}`);
});

Then('the Slack app name should be {string}', function (appName: string) {
  const region = session.region ?? 'us';
  const expected = region === 'eu' ? 'Amplitude - EU' : 'Amplitude';
  assert.strictEqual(
    expected,
    appName,
    `Expected app name "${appName}" for region "${region}" but got "${expected}"`,
  );
});

Then('I should be on the standalone Slack setup screen', function () {
  const screen = router.resolve(session);
  assert.strictEqual(
    screen,
    Screen.SlackSetup,
    `Expected SlackSetup but got ${screen}`,
  );
});
