import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert';
import { Screen } from '../../src/ui/tui/flows.js';
import { ctx } from './wizard-flow-context.js';

// Uses the shared ctx from wizard-flow-context so all steps in a scenario share
// the same router/session instance regardless of which file defines the step.

// ── Given ─────────────────────────────────────────────────────────────────────

Given(/^I am in the Org \/ Project Selection flow$/, function () {
  ctx.session.credentials = {
    accessToken: 'id-token-abc',
    projectApiKey: 'api-key-xyz',
    host: 'https://api.amplitude.com',
    projectId: 0,
  };
  ctx.session.region = 'us';
  ctx.session.projectHasData = true;
  ctx.session.newProjectConfirmed = true;
  ctx.session.orgProjectComplete = false;
  const screen = ctx.router.resolve(ctx.session);
  assert.strictEqual(screen, Screen.OrgProject, `Expected OrgProject but got ${screen}`);
});

// ── When ──────────────────────────────────────────────────────────────────────

When('I select an existing org from the org picker', function () {
  ctx.session.selectedOrgId = 'org-1';
  ctx.session.selectedOrgName = 'Acme';
});

When('I select an existing project from the project picker', function () {
  ctx.session.selectedWorkspaceId = 'ws-1';
  ctx.session.selectedWorkspaceName = 'Default';
  ctx.session.orgProjectComplete = true;
});

When('I select {string} from the org picker', function (_option: string) {
  // "Create new" — user will enter a name on the next step
});

When('I enter a name for the new org', function () {
  ctx.session.selectedOrgId = 'new-org-1';
  ctx.session.selectedOrgName = 'My New Org';
  (ctx.session as Record<string, unknown>)._newOrgCreated = true;
});

When('I select {string} from the project picker', function (_option: string) {
  // "Create new" — user will enter a name on the next step
});

When('I enter a name for the new project', function () {
  ctx.session.selectedWorkspaceId = 'new-ws-1';
  ctx.session.selectedWorkspaceName = 'My New Project';
  ctx.session.orgProjectComplete = true;
  (ctx.session as Record<string, unknown>)._newProjectCreated = true;
});

// ── Then ──────────────────────────────────────────────────────────────────────

Then('I should continue with the selected org and project', function () {
  assert.ok(ctx.session.selectedOrgId, 'Expected selectedOrgId to be set');
  assert.ok(ctx.session.selectedWorkspaceId, 'Expected selectedWorkspaceId to be set');
  assert.ok(ctx.session.orgProjectComplete, 'Expected orgProjectComplete to be true');
  const screen = ctx.router.resolve(ctx.session);
  assert.notStrictEqual(screen, Screen.OrgProject, 'Expected router to advance past OrgProject');
});

Then('the new org should be created', function () {
  assert.ok(
    (ctx.session as Record<string, unknown>)._newOrgCreated,
    'Expected new org to be created',
  );
  assert.ok(ctx.session.selectedOrgId, 'Expected selectedOrgId to be set');
});

Then('I should see the project picker', function () {
  assert.ok(ctx.session.selectedOrgId, 'Expected org to be selected before project picker');
  assert.ok(!ctx.session.orgProjectComplete, 'Expected orgProjectComplete to still be false');
  const screen = ctx.router.resolve(ctx.session);
  assert.strictEqual(screen, Screen.OrgProject, `Expected OrgProject (project picker) but got ${screen}`);
});

Then('the new project should be created', function () {
  assert.ok(
    (ctx.session as Record<string, unknown>)._newProjectCreated,
    'Expected new project to be created',
  );
  assert.ok(ctx.session.selectedWorkspaceId, 'Expected selectedWorkspaceId to be set');
});

Then('I should continue with the selected org and new project', function () {
  assert.ok(ctx.session.selectedOrgId, 'Expected selectedOrgId to be set');
  assert.ok(ctx.session.selectedWorkspaceId, 'Expected selectedWorkspaceId to be set');
  assert.ok(ctx.session.orgProjectComplete, 'Expected orgProjectComplete to be true');
  const screen = ctx.router.resolve(ctx.session);
  assert.notStrictEqual(screen, Screen.OrgProject, 'Expected router to advance past OrgProject');
});

Then('both the new org and project should be created', function () {
  assert.ok(
    (ctx.session as Record<string, unknown>)._newOrgCreated,
    'Expected new org to be created',
  );
  assert.ok(
    (ctx.session as Record<string, unknown>)._newProjectCreated,
    'Expected new project to be created',
  );
});

Then('I should continue with the new org and project', function () {
  assert.ok(ctx.session.selectedOrgId, 'Expected selectedOrgId to be set');
  assert.ok(ctx.session.selectedWorkspaceId, 'Expected selectedWorkspaceId to be set');
  assert.ok(ctx.session.orgProjectComplete, 'Expected orgProjectComplete to be true');
  const screen = ctx.router.resolve(ctx.session);
  assert.notStrictEqual(screen, Screen.OrgProject, 'Expected router to advance past OrgProject');
});

Then('I should see the org picker', function () {
  const screen = ctx.router.resolve(ctx.session);
  assert.strictEqual(screen, Screen.OrgProject, `Expected OrgProject (org picker) but got ${screen}`);
});

Then('I should see the project picker for the current org', function () {
  const screen = ctx.router.resolve(ctx.session);
  assert.strictEqual(screen, Screen.OrgProject, `Expected OrgProject (project picker) but got ${screen}`);
});

Then('after selecting, the data check should re-run for the new context', function () {
  ctx.session.orgProjectComplete = true;
  ctx.session.projectHasData = null;
  const screen = ctx.router.resolve(ctx.session);
  assert.strictEqual(screen, Screen.DataSetup, `Expected DataSetup to re-run but got ${screen}`);
});

Then('after selecting a new org the wizard should resume with the new context', function () {
  ctx.session.orgProjectComplete = true;
  ctx.session.projectHasData = null;
  const screen = ctx.router.resolve(ctx.session);
  assert.strictEqual(screen, Screen.DataSetup, `Expected DataSetup to re-run but got ${screen}`);
});

Then('after selecting a new project the wizard should resume with the new context', function () {
  ctx.session.orgProjectComplete = true;
  ctx.session.projectHasData = null;
  const screen = ctx.router.resolve(ctx.session);
  assert.strictEqual(screen, Screen.DataSetup, `Expected DataSetup to re-run but got ${screen}`);
});

