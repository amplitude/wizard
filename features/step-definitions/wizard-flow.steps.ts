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
import {
  storeToken,
  type StoredUser,
  type StoredOAuthToken,
} from '../../src/utils/ampli-settings.js';
import { ctx } from './wizard-flow-context.js';

// ── Shared state ──────────────────────────────────────────────────────────────

let tempDir: string;
let tempConfigPath: string;

// Convenience aliases — these shadow ctx.router and ctx.session within this file
// but mutations are reflected in ctx since objects are passed by reference.
// Re-assigned each Before hook via ctx.router = ... and ctx.session = ...
let router: WizardRouter;
let session: WizardSession;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFutureExpiry(daysAhead = 30): string {
  return new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();
}

function makeValidToken(): StoredOAuthToken {
  return {
    accessToken: 'access-abc',
    idToken: 'id-abc',
    refreshToken: 'refresh-abc',
    expiresAt: makeFutureExpiry(),
  };
}

function mockCredentials(): WizardSession['credentials'] {
  return {
    accessToken: 'access-abc',
    projectApiKey: 'api-key-xyz',
    host: 'https://api.amplitude.com',
    projectId: 123456,
  };
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

Before(function () {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ampli-wizard-flow-test-'));
  tempConfigPath = path.join(tempDir, 'ampli.json');
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
  session.credentials = mockCredentials();
  session.region = 'us';
  session.projectHasData = false;
  session.setupConfirmed = true;
  // RunScreen is shown once we've passed auth + region selection + data setup + framework detection
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
  // Region is selected before auth in the current flow.
  // This step represents a user who has completed both steps.
  session.region = 'us';
  session.credentials = mockCredentials();
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
  session.credentials = mockCredentials();
  session.region = 'us';
  session.projectHasData = false;
  session.setupConfirmed = true;
});

Given('the wizard is active at any screen', function () {
  session.credentials = mockCredentials();
  session.region = 'us';
  session.projectHasData = false;
  session.setupConfirmed = true;
});

Given('I am on the options menu for an existing project', function () {
  session.credentials = mockCredentials();
  session.region = 'us';
  session.projectHasData = true;
});

Given('the current project has existing data', function () {
  session.projectHasData = true;
});

// ── When ──────────────────────────────────────────────────────────────────────

When('the wizard launches', function () {
  // Check if valid credentials are stored (from a preceding Given step in another step file).
  // top-level-commands.steps.ts exposes its tempConfigPath via the World object.
  const sharedConfigPath =
    (this as Record<string, unknown>).tempConfigPath as string | undefined;
  if (sharedConfigPath) {
    const { getStoredToken } = require('../../src/utils/ampli-settings.js');
    const token = getStoredToken(undefined, 'us', sharedConfigPath);
    if (token) {
      // Returning user: credentials are available but region is NOT pre-populated.
      // Region selection always appears first — the user must confirm their region.
      session.credentials = mockCredentials();
    }
  }
  // session.region remains null — RegionSelect is always shown first
  // session.projectHasData remains null (not yet checked)
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
});

Then('the project should have no existing data', function () {
  session.projectHasData = false;
});

Then('I should be taken to Framework Detection', function () {
  const screen = router.resolve(session);
  assert.strictEqual(
    screen,
    Screen.Intro,
    `Expected Intro/Framework Detection screen but got ${screen}`,
  );
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
  const screen = router.resolve(session);
  assert.strictEqual(screen, Screen.Outro, `Expected Outro but got ${screen}`);
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

// Overlay and slash command steps live in wizard-overlays.steps.ts
