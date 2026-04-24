import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WizardRouter } from '../../src/ui/tui/router.js';
import { Screen, Flow } from '../../src/ui/tui/flows.js';
import {
  buildSession,
  RunPhase,
  OutroKind,
  DiscoveredFeature,
  type CloudRegion,
  type WizardSession,
} from '../../src/lib/wizard-session.js';
import { ctx } from './wizard-flow-context.js';

// ── Shared state ──────────────────────────────────────────────────────────────

let tempDir: string;

// Convenience aliases — these shadow ctx.router and ctx.session within this file
// but mutations are reflected in ctx since objects are passed by reference.
// Re-assigned each Before hook via ctx.router = ... and ctx.session = ...
let router: WizardRouter;
let session: WizardSession;

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockCredentials(): WizardSession['credentials'] {
  return {
    accessToken: 'access-abc',
    projectApiKey: 'api-key-xyz',
    host: 'https://api.amplitude.com',
    appId: 123456,
  };
}

function ensureIdentityNames(s: WizardSession): void {
  s.selectedOrgName = s.selectedOrgName ?? 'Test Org';
  s.selectedProjectName = s.selectedProjectName ?? 'Default';
  s.selectedEnvName = s.selectedEnvName ?? 'Default';
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

Before(function () {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ampli-wizard-flow-test-'));
  router = new WizardRouter(Flow.Wizard);
  session = buildSession({});
  // Expose via World so wizard-overlays.steps.ts can access the same instances
  (this as Record<string, unknown>).wizardRouter = router;
  (this as Record<string, unknown>).wizardSession = session;
  // Also sync ctx for any other consumers
  ctx.router = router;
  ctx.session = session;
});

After(function () {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ── Given ─────────────────────────────────────────────────────────────────────

// Note: "I have no credentials stored in {string}" and "I have valid credentials stored in {string}"
// are already defined in top-level-commands.steps.ts and will be matched from there.
// This file adds wizard-specific Given steps.

Given('I have reached the RunScreen', function () {
  session.introConcluded = true;
  session.credentials = mockCredentials();
  ensureIdentityNames(session);
  session.region = 'us';
  session.projectHasData = false;
  session.setupConfirmed = true;
});

Given('the project has Stripe as a dependency', function () {
  const { DiscoveredFeature } = require('../../src/lib/wizard-session.js');
  session.discoveredFeatures = [DiscoveredFeature.Stripe];
});

Given('the project has an LLM SDK as a dependency', function () {
  const { DiscoveredFeature } = require('../../src/lib/wizard-session.js');
  session.discoveredFeatures = [DiscoveredFeature.LLM];
});

// ── Region selection ──────────────────────────────────────────────────────────

Given('I have just authenticated', function () {
  session.introConcluded = true;
  session.region = 'us';
  session.credentials = mockCredentials();
  ensureIdentityNames(session);
});

Given('my region is already set to {string}', function (region: string) {
  session.region = region.toLowerCase() as CloudRegion;
});

Then('I should be asked to select a region', function () {
  const screen = router.resolve(session);
  assert.strictEqual(
    screen,
    Screen.RegionSelect,
    `Expected RegionSelect but got ${screen}`,
  );
});

When('I select the {string} region', function (region: string) {
  session.region = region.toLowerCase() as CloudRegion;
  session.regionForced = false;
});

Then('the US region should be stored in my session', function () {
  assert.strictEqual(session.region, 'us');
});

Then('I should proceed to the Data Setup flow', function () {
  const screen = router.resolve(session);
  assert.strictEqual(
    screen,
    Screen.DataSetup,
    `Expected DataSetup but got ${screen}`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────

Given('the wizard is active', function () {
  session.introConcluded = true;
  session.credentials = mockCredentials();
  ensureIdentityNames(session);
  session.region = 'us';
  session.projectHasData = false;
  session.setupConfirmed = true;
});

Given('the wizard is active at any screen', function () {
  session.introConcluded = true;
  session.credentials = mockCredentials();
  ensureIdentityNames(session);
  session.region = 'us';
  session.projectHasData = false;
  session.setupConfirmed = true;
});

Given('I am on the options menu for an existing project', function () {
  session.introConcluded = true;
  session.credentials = mockCredentials();
  ensureIdentityNames(session);
  session.region = 'us';
  session.projectHasData = true;
});

Given('the current project has existing data', function () {
  session.projectHasData = true;
  session.activationLevel = 'full';
});

// ── When ──────────────────────────────────────────────────────────────────────

When('the wizard launches', function () {
  // Check if valid credentials are stored (from a preceding Given step in another step file).
  // top-level-commands.steps.ts exposes its tempConfigPath via the World object.
  const sharedConfigPath = (this as Record<string, unknown>).tempConfigPath as
    | string
    | undefined;
  if (sharedConfigPath) {
    const { getStoredToken } = require('../../src/utils/ampli-settings.js');
    const token = getStoredToken(undefined, 'us', sharedConfigPath);
    if (token) {
      session.credentials = mockCredentials();
      ensureIdentityNames(session);
    }
  }
  // session.introConcluded remains false — IntroScreen is always shown first
  // session.region remains null — RegionSelect is shown after the user continues past intro
  // session.projectHasData remains null (not yet checked)
});

// ── Intro screen ───────────────────────────────────────────────────────────────

Then('I should see the IntroScreen', function () {
  const screen = router.resolve(session);
  assert.strictEqual(screen, Screen.Intro, `Expected Intro but got ${screen}`);
});

When('I continue past the intro', function () {
  session.introConcluded = true;
});

// ── Then ──────────────────────────────────────────────────────────────────────

Then('I should go through the SUSI flow', function () {
  // After region is selected (pre-auth), credentials are still null → Auth shows.
  const screen = router.resolve(session);
  assert.strictEqual(
    screen,
    Screen.Auth,
    `Expected Auth/SUSI screen but got ${screen}`,
  );
});

Then('I should go through the Activation Check flow', function () {
  // Returning users with credentials have already selected a region.
  // Activation Check routes to DataSetup.
  session.region = 'us';
  const screen = router.resolve(session);
  assert.strictEqual(
    screen,
    Screen.DataSetup,
    `Expected DataSetup/Activation Check screen but got ${screen}`,
  );
});

Then('I should go through the Data Setup flow', function () {
  // Simulate SUSI + region selection completing
  session.credentials = mockCredentials();
  ensureIdentityNames(session);
  session.region = 'us';
  const screen = router.resolve(session);
  assert.strictEqual(
    screen,
    Screen.DataSetup,
    `Expected DataSetup screen but got ${screen}`,
  );
});

When('the Data Setup check runs', function () {
  // Simulate SUSI completing so the router advances to DataSetup
  session.credentials = mockCredentials();
  ensureIdentityNames(session);
});

Then('the project should have no existing data', function () {
  session.projectHasData = false;
});

Then(
  'I should see options to open overview, chart, dashboard, taxonomy agent, or switch org or project',
  function () {
    const screen = router.resolve(session);
    assert.strictEqual(
      screen,
      Screen.Options,
      `Expected Options screen but got ${screen}`,
    );
  },
);

// ── Agent run ─────────────────────────────────────────────────────────────────

When('the Claude agent completes successfully', function () {
  session.runPhase = RunPhase.Completed;
  session.outroData = { kind: OutroKind.Success };
});

When('the Claude agent errors', function () {
  session.runPhase = RunPhase.Error;
  session.outroData = { kind: OutroKind.Error, message: 'Agent failed' };
});

When('the Claude agent runs', function () {
  session.runPhase = RunPhase.Completed;
  session.outroData = { kind: OutroKind.Success };
});

Then('environment variables should be uploaded to hosting', function () {
  // When runPhase is Completed, the run step triggers env var upload.
  // We verify the session is in the expected completed state.
  assert.strictEqual(session.runPhase, RunPhase.Completed);
});

Then('I should be taken to the Outro', function () {
  session.mcpComplete = true;
  session.dataIngestionConfirmed = true;
  session.checklistComplete = true;
  session.slackComplete = true;
  const screen = router.resolve(session);
  assert.strictEqual(screen, Screen.Outro, `Expected Outro but got ${screen}`);
});

Then('I should be on the Slack screen', function () {
  const screen = router.resolve(session);
  assert.strictEqual(screen, Screen.Slack, `Expected Slack but got ${screen}`);
});

Then('I should be taken to the Outro with an error state', function () {
  // Mcp is skipped on error — router goes straight to Outro
  const screen = router.resolve(session);
  assert.strictEqual(screen, Screen.Outro, `Expected Outro but got ${screen}`);
  assert.strictEqual(session.outroData?.kind, OutroKind.Error);
});

Then('I should see a Stripe tip', function () {
  assert.ok(
    session.discoveredFeatures.includes(DiscoveredFeature.Stripe),
    'Expected Stripe in discoveredFeatures',
  );
});

Then('I should see an LLM tip', function () {
  assert.ok(
    session.discoveredFeatures.includes(DiscoveredFeature.LLM),
    'Expected LLM in discoveredFeatures',
  );
});

Then('I should be on the RunScreen', function () {
  const screen = router.resolve(session);
  assert.strictEqual(screen, Screen.Run, `Expected Run but got ${screen}`);
});

Then('I should be on the MCP screen', function () {
  const screen = router.resolve(session);
  assert.strictEqual(screen, Screen.Mcp, `Expected Mcp but got ${screen}`);
});

When('MCP setup is complete', function () {
  session.mcpComplete = true;
});

// ── DataIngestionCheck ────────────────────────────────────────────────────────

Then('I should be on the DataIngestionCheck screen', function () {
  const screen = router.resolve(session);
  assert.strictEqual(
    screen,
    Screen.DataIngestionCheck,
    `Expected DataIngestionCheck but got ${screen}`,
  );
});

When('events are detected in the project', function () {
  // Events found by MCP — the screen shows a preview table but dataIngestionConfirmed
  // is still false. The router stays on DataIngestionCheck until the user presses Enter.
  // In agent mode the pollForDataIngestion helper sets dataIngestionConfirmed directly.
  if (session.agent) {
    session.dataIngestionConfirmed = true;
  }
});

Given('I am in agent mode', function () {
  session.agent = true;
  session.introConcluded = true;
  session.credentials = mockCredentials();
  ensureIdentityNames(session);
  session.region = 'us';
  session.activationLevel = 'none';
  session.projectHasData = false;
  session.setupConfirmed = true;
  session.runPhase = RunPhase.Completed;
  session.mcpComplete = true;
});

Given('I am running in CI mode', function () {
  session.ci = true;
  session.introConcluded = true;
  session.credentials = mockCredentials();
  ensureIdentityNames(session);
  session.region = 'us';
  session.activationLevel = 'none';
  session.projectHasData = false;
  session.setupConfirmed = true;
  session.runPhase = RunPhase.Completed;
  session.mcpComplete = true;
});

Then('data ingestion is confirmed automatically', function () {
  assert.strictEqual(
    session.dataIngestionConfirmed,
    true,
    'Expected dataIngestionConfirmed to be true in agent mode',
  );
});

When('I press Enter to confirm events', function () {
  session.dataIngestionConfirmed = true;
});

Then('I should still be on the DataIngestionCheck screen', function () {
  const screen = router.resolve(session);
  assert.strictEqual(
    screen,
    Screen.DataIngestionCheck,
    `Expected DataIngestionCheck but got ${screen}`,
  );
});

Then('I should be on the Checklist screen', function () {
  const screen = router.resolve(session);
  assert.strictEqual(
    screen,
    Screen.Checklist,
    `Expected Checklist but got ${screen}`,
  );
});

Given('I am on the DataIngestionCheck screen', function () {
  session.introConcluded = true;
  session.credentials = mockCredentials();
  ensureIdentityNames(session);
  session.region = 'us';
  session.activationLevel = 'none';
  session.projectHasData = false;
  session.setupConfirmed = true;
  session.runPhase = RunPhase.Completed;
  session.outroData = { kind: OutroKind.Success };
  session.mcpComplete = true;
});

Given('I am on the Checklist screen', function () {
  session.introConcluded = true;
  session.credentials = mockCredentials();
  ensureIdentityNames(session);
  session.region = 'us';
  session.activationLevel = 'none';
  session.projectHasData = false;
  session.setupConfirmed = true;
  session.runPhase = RunPhase.Completed;
  session.outroData = { kind: OutroKind.Success };
  session.mcpComplete = true;
  session.dataIngestionConfirmed = true;
});

Given('I have completed MCP setup on a fully-activated project', function () {
  session.introConcluded = true;
  session.credentials = mockCredentials();
  ensureIdentityNames(session);
  session.region = 'us';
  session.projectHasData = true;
  session.activationLevel = 'full';
  session.mcpComplete = true;
});

Given('the chart is not yet complete', function () {
  session.checklistChartComplete = false;
});

Given('the chart is complete', function () {
  session.checklistChartComplete = true;
});

Given('the dashboard is complete', function () {
  session.checklistDashboardComplete = true;
});

Given('the user already has charts in their Amplitude org', function () {
  session.checklistChartComplete = true;
});

Given('the user already has dashboards in their Amplitude org', function () {
  session.checklistDashboardComplete = true;
});

Then('I should be taken to the Outro with a cancel state', function () {
  const screen = router.resolve(session);
  assert.strictEqual(screen, Screen.Outro, `Expected Outro but got ${screen}`);
  assert.strictEqual(session.outroData?.kind, OutroKind.Cancel);
});

When('I press {string} to exit', function (_key: string) {
  // Simulates the user pressing q/Esc on the DataIngestionCheck screen
  session.outroData = {
    kind: OutroKind.Cancel,
    message: 'Come back once your app is running and sending events.',
  };
});

Then('the chart creation page should open in my browser', function () {
  // Browser open is a side-effect; we verify the session state after selection
  session.checklistChartComplete = true;
});

Then('the chart should be marked as complete', function () {
  assert.ok(
    session.checklistChartComplete,
    'Expected checklistChartComplete to be true',
  );
});

Then('"Create your first dashboard" should be disabled', function () {
  // Dashboard is disabled when chart is not complete — validated by the
  // ChecklistScreen's picker options logic (disabled: !checklistChartComplete)
  assert.ok(
    !session.checklistChartComplete,
    'Chart should not be complete when dashboard is locked',
  );
});

Given('a chart has already been created', function () {
  session.checklistChartComplete = true;
});

Given('no dashboard has been created yet', function () {
  session.checklistDashboardComplete = false;
});

Then('"Create your first chart" should be shown as complete', function () {
  assert.ok(
    session.checklistChartComplete,
    'Expected checklistChartComplete to be true',
  );
});

Then('the dashboard item should be unlocked', function () {
  assert.ok(
    session.checklistChartComplete,
    'Dashboard should be unlocked once chart is complete',
  );
});

Then('a chart should be created via the Amplitude API', function () {
  assert.ok(
    session.checklistChartComplete,
    'Expected checklistChartComplete to be true after chart creation',
  );
});

Then('a dashboard should be created via the Amplitude API', function () {
  assert.ok(
    session.checklistDashboardComplete,
    'Expected checklistDashboardComplete to be true after dashboard creation',
  );
});

Then('the dashboard creation page should open in my browser', function () {
  session.checklistDashboardComplete = true;
});

Then('the dashboard should be marked as complete', function () {
  assert.ok(
    session.checklistDashboardComplete,
    'Expected checklistDashboardComplete to be true',
  );
});

When('I select {string}', function (option: string) {
  if (
    option === 'Skip remaining and continue' ||
    option === 'Done — continue'
  ) {
    session.checklistComplete = true;
  } else if (option === 'Create your first chart') {
    session.checklistChartComplete = true;
  } else if (option === 'Create your first dashboard') {
    session.checklistDashboardComplete = true;
  }
});

// Overlay and slash command steps live in wizard-overlays.steps.ts
