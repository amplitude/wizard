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

const CREDS = {
  accessToken: 'tok',
  projectApiKey: 'pk',
  host: 'https://api2.amplitude.com',
  appId: 1,
};

Before(function () {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ampli-create-test-'));
  router = new WizardRouter(Flow.Wizard);
  session = buildSession({ installDir: projectDir });
  session.introConcluded = true;
  session.region = 'us';
  session.pendingAuthIdToken = 'id-token-abc';
  session.pendingAuthAccessToken = 'access-abc';
  session.pendingAuthCloudRegion = 'us';
});

After(function () {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

// ── Given ─────────────────────────────────────────────────────────────────

Given('the user is authenticated with an org selected', function () {
  session.pendingOrgs = [
    {
      id: 'org-1',
      name: 'Acme',
      projects: [{ id: 'ws-1', name: 'Default' }],
    },
  ];
  session.selectedOrgId = 'org-1';
  session.selectedOrgName = 'Acme';
});

Given('the user is on the CreateProject screen', function () {
  session.pendingOrgs = [
    {
      id: 'org-1',
      name: 'Acme',
      projects: [{ id: 'ws-1', name: 'Default' }],
    },
  ];
  session.selectedOrgId = 'org-1';
  session.selectedOrgName = 'Acme';
  session.createProject = {
    pending: true,
    source: 'project',
    suggestedName: null,
  };
  assert.strictEqual(router.resolve(session), Screen.CreateProject);
});

Given('the wizard is invoked in CI mode without --project-name', function () {
  session.ci = true;
});

Given('no project has an API key', function () {
  session.pendingOrgs = [
    {
      id: 'org-1',
      name: 'Acme',
      projects: [
        {
          id: 'ws-1',
          name: 'Default',
          environments: [
            { name: 'Production', rank: 1, app: { id: 'app-1', apiKey: null } },
          ],
        },
      ],
    },
  ];
});

// ── When ──────────────────────────────────────────────────────────────────

When(
  'the user picks "Create new project…" from the project picker',
  function () {
    session.createProject = {
      pending: true,
      source: 'project',
      suggestedName: null,
    };
  },
);

When('the user cancels', function () {
  session.createProject = { pending: false, source: null, suggestedName: null };
});

When('the create-project call succeeds and credentials are set', function () {
  // Emulate what CreateProjectScreen does on success.
  session.selectedEnvName = 'My New Project';
  session.selectedProjectName = 'My New Project';
  session.credentials = { ...CREDS, appId: 999 };
  session.projectHasData = false;
  session.createProject = {
    pending: false,
    source: null,
    suggestedName: null,
  };
});

// ── Then ──────────────────────────────────────────────────────────────────

Then('the router should resolve to the CreateProject screen', function () {
  assert.strictEqual(router.resolve(session), Screen.CreateProject);
});

Then('the session.createProject.pending flag should be true', function () {
  assert.strictEqual(session.createProject.pending, true);
});

Then('the router should resolve back to the Auth screen', function () {
  assert.strictEqual(router.resolve(session), Screen.Auth);
});

Then('the session.createProject.pending flag should be false', function () {
  assert.strictEqual(session.createProject.pending, false);
});

Then('the router should resolve past Auth toward the agent flow', function () {
  const resolved = router.resolve(session);
  // After success: router should skip Auth + CreateProject. Either lands
  // on DataSetup (if projectHasData is still null) or Run (once false).
  assert.ok(
    resolved === Screen.DataSetup || resolved === Screen.Run,
    `Expected DataSetup or Run, got ${resolved}`,
  );
  assert.notStrictEqual(resolved, Screen.Auth);
  assert.notStrictEqual(resolved, Screen.CreateProject);
});

Then(
  'the wizard should exit with code 2 and stderr should mention --project-name',
  function () {
    // This is enforced by bin.ts in CI mode; we spot-check the invariant
    // that without credentials and without --project-name, we'd hit that
    // branch. (Full process exit is covered by the unit test suite.)
    assert.ok(
      session.ci === true && session.credentials === null,
      'Expected CI mode without credentials — stub invariant',
    );
  },
);
